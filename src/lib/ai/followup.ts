import { supabaseAdmin } from './admin-client'
import { loadAiConfig } from './config'
import { buildConversationContext } from './context'
import { findCandidateAutomations } from './automation-match'
import { runAutomationById } from '@/lib/automations/engine'
import { engineSendInteractive } from '@/lib/automations/meta-send'
import { engineSendText } from '@/lib/flows/meta-send'
import { findConnectedAgentForArea } from './handoff-routing'
import { buildHandoffSummary } from './handoff'
import { buildHandoffNotice } from './business-hours'

const IDLE_MS = 10 * 60 * 1000
const HUMAN_PAUSE_MS = 5 * 60 * 1000
const WINDOW_MS = 24 * 60 * 60 * 1000
const REFUSAL = /no me interesa|no gracias|ya no|no quiero/i
export const FOLLOWUP_CONTINUE_ID = 'vortex_followup_continue'
export const FOLLOWUP_SALES_ID = 'vortex_followup_ventas'
export const FOLLOWUP_LOYALTY_ID = 'vortex_followup_fidelizacion'

/** Handle the Continue → area menu sent by the idle follow-up. */
export async function handleIdleFollowupReply(args: {
  accountId: string
  userId: string
  contactId: string
  conversationId: string
  replyId: string
}): Promise<boolean> {
  const { accountId, userId, contactId, conversationId, replyId } = args
  if (
    replyId !== FOLLOWUP_CONTINUE_ID &&
    replyId !== FOLLOWUP_SALES_ID &&
    replyId !== FOLLOWUP_LOYALTY_ID
  ) {
    return false
  }

  try {
    const db = supabaseAdmin()

    if (replyId === FOLLOWUP_CONTINUE_ID) {
      await engineSendInteractive({
        accountId,
        userId,
        contactId,
        conversationId,
        payload: {
          kind: 'buttons',
          body: 'Claro, ¿con qué área deseas continuar?',
          buttons: [
            { id: FOLLOWUP_SALES_ID, title: 'Ventas' },
            { id: FOLLOWUP_LOYALTY_ID, title: 'Fidelización' },
          ],
        },
      })
      await db
        .from('conversations')
        .update({ followup_sent_at: new Date().toISOString() })
        .eq('id', conversationId)
        .eq('account_id', accountId)
      return true
    }

    const area = replyId === FOLLOWUP_SALES_ID ? 'ventas' : 'fidelizacion'
    const { data: conversation, error } = await db
      .from('conversations')
      .select('assigned_agent_id, ai_reply_count')
      .eq('id', conversationId)
      .eq('account_id', accountId)
      .maybeSingle()
    if (error || !conversation) {
      console.error('[followup] failed to load conversation for area selection:', error)
      return true
    }

    const messages = await buildConversationContext(db, conversationId)
    const summary = buildHandoffSummary({
      messages,
      replyCount: conversation.ai_reply_count ?? 0,
    })
    const update: Record<string, unknown> = {
      ai_handoff_summary: summary,
      ai_handed_off_at: new Date().toISOString(),
    }
    let agentConnected = false

    if (!conversation.assigned_agent_id) {
      const { agentId } = await findConnectedAgentForArea(db, accountId, area)
      if (agentId) {
        update.assigned_agent_id = agentId
        agentConnected = true
      } else {
        const config = await loadAiConfig(db, accountId)
        if (config?.handoffAgentId) {
          update.assigned_agent_id = config.handoffAgentId
        }
      }
    }

    const { error: updateError } = await db
      .from('conversations')
      .update(update)
      .eq('id', conversationId)
      .eq('account_id', accountId)
    if (updateError) {
      console.error('[followup] failed to route area selection:', updateError)
      return true
    }

    await engineSendText({
      accountId,
      userId,
      contactId,
      conversationId,
      text: buildHandoffNotice({ area, agentConnected }),
      aiGenerated: true,
    })
    await db
      .from('conversations')
      .update({ followup_sent_at: new Date().toISOString() })
      .eq('id', conversationId)
      .eq('account_id', accountId)
    return true
  } catch (err) {
    console.error('[followup] failed to handle Continue reply:', err)
    return true
  }
}

/** Re-enable only controls that were manually turned off at least 5 minutes ago. */
export async function reactivateExpiredManualControls(): Promise<number> {
  const db = supabaseAdmin()
  const cutoff = new Date(Date.now() - HUMAN_PAUSE_MS).toISOString()
  let reactivated = 0

  const [aiResult, automationResult] = await Promise.all([
    db
      .from('conversations')
      .select('id, ai_disabled_at')
      .eq('ai_enabled', false)
      .lte('ai_disabled_at', cutoff)
      .order('ai_disabled_at', { ascending: true })
      .limit(100),
    db
      .from('conversations')
      .select('id, automation_disabled_at')
      .eq('automation_enabled', false)
      .lte('automation_disabled_at', cutoff)
      .order('automation_disabled_at', { ascending: true })
      .limit(100),
  ])

  if (aiResult.error) {
    console.error('[followup] failed to load expired AI controls:', aiResult.error)
  } else {
    reactivated += await reactivateRows(
      (aiResult.data ?? []).map((row) => ({
        id: row.id,
        disabled_at: row.ai_disabled_at,
      })),
      'ai_enabled',
      'ai_disabled_at',
    )
  }

  if (automationResult.error) {
    console.error(
      '[followup] failed to load expired automation controls:',
      automationResult.error,
    )
  } else {
    reactivated += await reactivateRows(
      (automationResult.data ?? []).map((row) => ({
        id: row.id,
        disabled_at: row.automation_disabled_at,
      })),
      'automation_enabled',
      'automation_disabled_at',
    )
  }

  return reactivated
}

async function reactivateRows(
  rows: Array<{ id: string; disabled_at: string | null }>,
  enabledColumn: 'ai_enabled' | 'automation_enabled',
  disabledAtColumn: 'ai_disabled_at' | 'automation_disabled_at',
): Promise<number> {
  const db = supabaseAdmin()
  let reactivated = 0

  for (const row of rows) {
    if (!row.disabled_at) continue
    const { data, error } = await db
      .from('conversations')
      .update({ [enabledColumn]: true, [disabledAtColumn]: null })
      .eq('id', row.id)
      .eq(enabledColumn, false)
      .eq(disabledAtColumn, row.disabled_at)
      .select('id')
      .maybeSingle()

    if (error) {
      console.error('[followup] failed to reactivate manual control:', error)
    } else if (data) {
      reactivated++
    }
  }

  return reactivated
}

/** If the customer has been waiting for 10 minutes, resume a matching
 * course automation or ask them to choose how they want to continue. */
export async function runIdleFollowups(): Promise<number> {
  let launched = 0
  try {
    const db = supabaseAdmin()
    const now = Date.now()
    const { data: convs, error } = await db
      .from('conversations')
      .select(
        'id, account_id, user_id, contact_id, last_message_at, followup_sent_at, last_human_message_at',
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

      if (REFUSAL.test(last.content_text ?? '')) {
        await claimFollowup(db, c)
        continue
      }
      const config = await loadAiConfig(db, c.account_id)
      if (!config || !config.autoReplyEnabled) continue

      const messages = await buildConversationContext(db, c.id)
      const candidates = messages.length > 0
        ? await findCandidateAutomations(db, c.account_id, messages, 3)
        : []
      const claim = await claimFollowup(db, c)
      if (!claim) continue

      try {
        if (candidates.length > 0) {
          const ok = await runAutomationById({
            accountId: c.account_id,
            automationId: candidates[0].id,
            contactId: c.contact_id,
            conversationId: c.id,
            messageText: '',
          })
          if (ok) launched++
          else await releaseFollowupClaim(db, c, claim)
        } else {
          await engineSendInteractive({
            accountId: c.account_id,
            userId: c.user_id,
            contactId: c.contact_id,
            conversationId: c.id,
            payload: {
              kind: 'buttons',
              body: '¿Quieres que retomemos la conversación? Pulsa continuar y te ayudamos a elegir el área.',
              buttons: [{ id: FOLLOWUP_CONTINUE_ID, title: 'Continuar' }],
            },
          })
          launched++
        }
      } catch (err) {
        await releaseFollowupClaim(db, c, claim)
        console.error('[followup] failed to send idle follow-up:', err)
      }
    }
  } catch (err) {
    console.error('[followup] failed:', err)
  }
  return launched
}

async function claimFollowup(
  db: ReturnType<typeof supabaseAdmin>,
  conversation: {
    id: string
    last_message_at: string
    followup_sent_at: string | null
  },
): Promise<string | null> {
  const claimedAt = new Date().toISOString()
  let query = db
    .from('conversations')
    .update({ followup_sent_at: claimedAt })
    .eq('id', conversation.id)
    .eq('last_message_at', conversation.last_message_at)

  query = conversation.followup_sent_at
    ? query.eq('followup_sent_at', conversation.followup_sent_at)
    : query.is('followup_sent_at', null)

  const { data, error } = await query.select('id').maybeSingle()
  if (error) {
    console.error('[followup] failed to claim idle follow-up:', error)
    return null
  }
  return data ? claimedAt : null
}

async function releaseFollowupClaim(
  db: ReturnType<typeof supabaseAdmin>,
  conversation: {
    id: string
    followup_sent_at: string | null
  },
  claimedAt: string,
) {
  await db
    .from('conversations')
    .update({ followup_sent_at: conversation.followup_sent_at })
    .eq('id', conversation.id)
    .eq('followup_sent_at', claimedAt)
}
