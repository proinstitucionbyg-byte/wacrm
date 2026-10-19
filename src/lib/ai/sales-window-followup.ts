import type { SupabaseClient } from '@supabase/supabase-js'
import { engineSendInteractive } from '@/lib/automations/meta-send'
import { validateInteractivePayload, type InteractiveButtonsPayload } from '@/lib/whatsapp/interactive'
import { isLikelyAutomatedInbound } from './automated-inbound'
import { buildConversationContext } from './context'
import { conversationCourse, salesCourseKey } from './automation-match'
import { idleFollowupArea } from './followup-policy'

const HOUR = 3_600_000
export function salesClosingWindowOpen(inboundAt: string, now = Date.now()): boolean {
  const age = now - Date.parse(inboundAt)
  return age >= 23 * HOUR && age < 24 * HOUR
}

export interface SalesClosingCandidate {
  conversation_id: string
  account_id: string
  user_id: string
  contact_id: string
  inbound_id: string
  inbound_at: string
  inbound_text: string | null
  automation_id: string
  automation_name: string
  step_id: string
  payload: InteractiveButtonsPayload
}

/** Explicit repeat, once per customer window. Never launch/restart the course. */
export async function runSalesWindowFollowups(db: SupabaseClient): Promise<number> {
  const { data, error } = await db.rpc('sales_window_followup_candidates')
  if (error) throw error
  let sent = 0
  for (const candidate of (data ?? []) as SalesClosingCandidate[]) {
    try {
      if (!salesClosingWindowOpen(candidate.inbound_at)
        || isLikelyAutomatedInbound(candidate.inbound_text)
        || /no me interesa|no gracias|ya no|no quiero|no (?:me )?(?:escrib|contact)|deja de (?:escrib|enviar)/i.test(candidate.inbound_text ?? '')
        || /ya (?:pagu[eé]|abon[eé]|(?:gener[eé]|hice|realic[eé]) (?:el )?(?:abono|pago|dep[oó]sito))/i.test(candidate.inbound_text ?? '')) continue
      const context = await buildConversationContext(db, candidate.conversation_id, 5)
      const messages = [{ role: 'user' as const, content: candidate.inbound_text ?? '' }, ...context]
      if (idleFollowupArea(messages, 'VENTAS') !== 'ventas') continue
      const course = conversationCourse(messages)
      if (course && course !== salesCourseKey(candidate.automation_name)) continue

      // SQL rechecks the latest inbound, payment, area, finished course and wait
      // under a conversation lock. The unique reservation prevents cron overlap.
      const claim = await db.rpc('claim_sales_window_followup', {
        p_conversation: candidate.conversation_id, p_inbound: candidate.inbound_id,
        p_step: candidate.step_id,
      })
      if (claim.error) throw claim.error
      const reserved = claim.data?.[0] as { id: string; payload: InteractiveButtonsPayload; inbound_at: string } | undefined
      if (!reserved) continue
      try {
        if (!salesClosingWindowOpen(reserved.inbound_at)) throw Error('La ventana de WhatsApp ya cerró.')
        const validation = validateInteractivePayload(reserved.payload)
        if (reserved.payload.kind !== 'buttons' || !validation.ok) throw Error('El cierre del curso no tiene botones válidos.')
        const result = await engineSendInteractive({ accountId: candidate.account_id,
          userId: candidate.user_id, conversationId: candidate.conversation_id,
          contactId: candidate.contact_id, payload: reserved.payload })
        const saved = await db.from('sales_window_followups').update({ status: 'sent',
          message_id: result.whatsapp_message_id, sent_at: new Date().toISOString() }).eq('id', reserved.id)
        if (saved.error) throw saved.error
        sent++
      } catch (error) {
        // An uncertain send must never be automatically repeated.
        const recorded = await db.from('sales_window_followups').update({ status: 'review',
          error: error instanceof Error ? error.message : String(error) }).eq('id', reserved.id)
        if (recorded.error) console.error('[sales closing] failed to record review', recorded.error)
        console.error('[sales closing] send needs review', error)
      }
    } catch (error) { console.error('[sales closing] candidate failed', error) }
  }
  return sent
}
