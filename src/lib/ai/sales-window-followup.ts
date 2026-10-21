import type { SupabaseClient } from '@supabase/supabase-js'
import { engineSendInteractive, engineSendMedia } from '@/lib/automations/meta-send'
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

interface ClosingStep {
  id: string
  step_type: string
  step_config: Record<string, unknown>
  position: number
}

interface ClosingAutomation {
  id: string
  user_id: string
  steps: ClosingStep[]
}

async function closingAutomation(db: SupabaseClient, accountId: string): Promise<ClosingAutomation | null> {
  const { data: flows, error } = await db.from('automations')
    .select('id,user_id').eq('account_id', accountId).eq('is_active', true)
    .contains('trigger_config', { sales_window_last_call: true }).limit(2)
  if (error) throw error
  if (flows?.length !== 1) return null
  const { data: steps, error: stepsError } = await db.from('automation_steps')
    .select('id,step_type,step_config,position').eq('automation_id', flows[0].id)
    .is('parent_step_id', null).order('position', { ascending: true })
  if (stepsError) throw stepsError
  if (steps?.length !== 3 || steps[0].step_type !== 'send_media'
    || steps[1].step_type !== 'send_media' || steps[2].step_type !== 'send_buttons') return null
  const image = steps[0].step_config as Record<string, unknown>
  const audio = steps[1].step_config as Record<string, unknown>
  if (image.media_type !== 'image' || audio.media_type !== 'audio'
    || typeof image.media_url !== 'string' || typeof image.caption !== 'string'
    || typeof audio.media_url !== 'string') return null
  for (const url of [image.media_url, audio.media_url]) {
    if (new URL(url).protocol !== 'https:') return null
  }
  const buttons = steps[2].step_config as unknown as InteractiveButtonsPayload
  if (buttons.kind !== 'buttons' || !validateInteractivePayload(buttons).ok) return null
  return { id: flows[0].id, user_id: flows[0].user_id, steps: steps as ClosingStep[] }
}

/** One configured closing sequence per customer window. Never restart the course. */
export async function runSalesWindowFollowups(db: SupabaseClient): Promise<number> {
  const { data, error } = await db.rpc('sales_window_followup_candidates')
  if (error) throw error
  let sent = 0
  const closingByAccount = new Map<string, ClosingAutomation | null>()
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

      // The current image and audio both quote S/49.90. Keep older S/79.90
      // conversations on their own material until an approved image exists.
      if (!/\(49[.,]90\)/.test(candidate.automation_name)) continue
      if (!closingByAccount.has(candidate.account_id))
        closingByAccount.set(candidate.account_id, await closingAutomation(db, candidate.account_id))
      const closing = closingByAccount.get(candidate.account_id)
      if (!closing) continue

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
        const common = { accountId: candidate.account_id, userId: closing.user_id,
          conversationId: candidate.conversation_id, contactId: candidate.contact_id }
        const image = closing.steps[0].step_config
        const audio = closing.steps[1].step_config
        const buttons = closing.steps[2].step_config as unknown as InteractiveButtonsPayload
        const imageResult = await engineSendMedia({ ...common, mediaType: 'image',
          mediaUrl: image.media_url as string, caption: image.caption as string })
        if (!salesClosingWindowOpen(reserved.inbound_at)) throw Error('La ventana cerró después de la imagen.')
        const audioResult = await engineSendMedia({ ...common, mediaType: 'audio',
          mediaUrl: audio.media_url as string,
          transcript: typeof audio.audio_transcript === 'string' ? audio.audio_transcript : undefined })
        if (!salesClosingWindowOpen(reserved.inbound_at)) throw Error('La ventana cerró después del audio.')
        const result = await engineSendInteractive({ ...common, payload: buttons })
        const saved = await db.from('sales_window_followups').update({ status: 'sent',
          message_id: result.whatsapp_message_id, sent_at: new Date().toISOString(),
          error: `Meta aceptó imagen ${imageResult.whatsapp_message_id}, audio ${audioResult.whatsapp_message_id} y botón ${result.whatsapp_message_id}; entrega pendiente de confirmación.` }).eq('id', reserved.id)
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
