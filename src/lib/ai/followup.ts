import { supabaseAdmin } from './admin-client'
import { loadAiConfig } from './config'
import { buildConversationContext } from './context'
import { findCandidateAutomations } from './automation-match'
import { runAutomationById } from '@/lib/automations/engine'

const IDLE_MS = 10 * 60 * 1000
const HUMAN_PAUSE_MS = 5 * 60 * 1000
const WINDOW_MS = 24 * 60 * 60 * 1000
const REFUSAL = /no me interesa|no gracias|ya no|no quiero/i

/** Si el cliente escribió y nadie respondió en 10 min, lanza la
 *  automatización del curso que mencionó. Una vez por mensaje. */
export async function runIdleFollowups(): Promise<number> {
  let launched = 0
  try {
    const db = supabaseAdmin()
    const now = Date.now()
    const { data: convs, error } = await db
      .from('conversations')
      .select(
        'id, account_id, contact_id, last_message_at, followup_sent_at, last_human_message_at',
      )
      .lt('last_message_at', new Date(now - IDLE_MS).toISOString())
      .gt('last_message_at', new Date(now - WINDOW_MS).toISOString())
      .eq('ai_enabled', true)
      .eq('automation_enabled', true)
      .order('last_message_at', { ascending: false })
      .limit(50)
    if (error || !convs) return 0

    for (const c of convs) {
      const lastMsg = new Date(c.last_message_at).getTime()
      if (c.followup_sent_at && new Date(c.followup_sent_at).getTime() >= lastMsg) continue
      const lastHuman = c.last_human_message_at
        ? new Date(c.last_human_message_at).getTime()
        : 0
      if (now - lastHuman < HUMAN_PAUSE_MS) continue

      const { data: last } = await db
        .from('messages')
        .select('sender_type, content_text')
        .eq('conversation_id', c.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (last?.sender_type !== 'customer') continue

      // Marca primero para no repetirlo cada minuto.
      await db
        .from('conversations')
        .update({ followup_sent_at: new Date().toISOString() })
        .eq('id', c.id)

      if (REFUSAL.test(last.content_text ?? '')) continue
      const config = await loadAiConfig(db, c.account_id)
      if (!config || !config.autoReplyEnabled) continue

      const messages = await buildConversationContext(db, c.id)
      if (messages.length === 0) continue
      const candidates = await findCandidateAutomations(db, c.account_id, messages, 3)
      if (candidates.length === 0) continue

      const ok = await runAutomationById({
        accountId: c.account_id,
        automationId: candidates[0].id,
        contactId: c.contact_id,
        conversationId: c.id,
        messageText: '',
      })
      if (ok) launched++
    }
  } catch (err) {
    console.error('[followup] failed:', err)
  }
  return launched
}