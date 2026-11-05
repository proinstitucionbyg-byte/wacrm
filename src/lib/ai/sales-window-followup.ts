import type { SupabaseClient } from '@supabase/supabase-js'
import { isLikelyAutomatedInbound } from './automated-inbound'
import { buildConversationContext } from './context'
import { idleFollowupArea } from './followup-policy'
export function salesClosingWindowOpen(inboundAt: string, now = Date.now()): boolean {
  const age = now - Date.parse(inboundAt)
  return age >= 23.5 * 3_600_000 && age < 24 * 3_600_000
}
export interface SalesClosingCandidate {
  conversation_id: string; account_id: string; user_id: string; contact_id: string
  inbound_id: string; inbound_at: string; inbound_text: string | null
  automation_id: string; automation_name: string; step_id: string; payload: unknown
}
/** Atomic SQL claim queues original steps, including durable waits, in the engine. */
export async function runSalesWindowFollowups(db: SupabaseClient): Promise<number> {
  const { data, error } = await db.rpc('sales_window_followup_candidates')
  if (error) throw error
  let queued = 0
  for (const candidate of (data ?? []) as SalesClosingCandidate[]) {
    try {
      if (!salesClosingWindowOpen(candidate.inbound_at)
        || isLikelyAutomatedInbound(candidate.inbound_text)
        || /no me interesa|no gracias|ya no|no quiero|no (?:me )?(?:escrib|contact)|deja de (?:escrib|enviar)/i.test(candidate.inbound_text ?? '')
        || /ya (?:pagu[eé]|abon[eé]|(?:gener[eé]|hice|realic[eé]) (?:el )?(?:abono|pago|dep[oó]sito))/i.test(candidate.inbound_text ?? '')) continue
      const context = await buildConversationContext(db, candidate.conversation_id, 5)
      if (idleFollowupArea([{ role: 'user', content: candidate.inbound_text ?? '' }, ...context], 'VENTAS') !== 'ventas') continue
      const claim = await db.rpc('claim_sales_window_followup', {
        p_conversation: candidate.conversation_id, p_inbound: candidate.inbound_id, p_step: candidate.step_id,
      })
      if (claim.error) throw claim.error
      if (claim.data?.length) queued++
    } catch (error) { console.error('[sales closing] candidate failed', error) }
  }
  return queued
}
