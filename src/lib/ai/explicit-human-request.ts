import type { SupabaseClient } from '@supabase/supabase-js'
import { engineSendText } from '@/lib/automations/meta-send'
import { routeConversationToArea, explicitlyRequestedArea } from './handoff-routing'
import { isOpenNow, SCHEDULE_TEXT } from './business-hours'

export function explicitlyWantsHuman(raw: string, replyId?: string | null): boolean {
  if (replyId === 'commercial_human' || replyId === 'payment_followup_help') return true
  const text = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/\brecursos humanos\b/g, 'recursos')
  if (/\bno (?:quiero|necesito|deseo) (?:un |una )?(?:asesor|asesora|persona|humano)/.test(text)) return false
  return /^\s*(?:un |una )?asesora?(?: por favor| porfa)?[.!?¿¡\s]*$/.test(text)
    || /\b(?:quiero|necesito|deseo|quisiera|podria|puedo|puede|puedes|pasame|pasen|comunicarme|hablar|contactar|atenderme)\b.{0,70}\b(?:asesora?|persona|humano|humana|alguien)\b/.test(text)
    || /\b(?:asesora?|persona) (?:real|humana|humano)\b|\b(?:eres|pareces|parece|son|puras) (?:un |una )?(?:bot|robot|maquina|maquinas)\b/.test(text)
}

/** Pause before the sales/AI dispatch. This path makes no model calls. */
export async function handleExplicitHumanRequest(db: SupabaseClient, args: {
  accountId: string; conversationId: string; contactId: string; userId: string
  text: string; replyId?: string | null
}): Promise<boolean> {
  if (!explicitlyWantsHuman(args.text, args.replyId)) return false
  const { data: conversation, error } = await db.from('conversations')
    .select('id,ai_enabled,automation_enabled,ai_handed_off_at,ai_handoff_area,ai_handoff_summary')
    .eq('id', args.conversationId).eq('account_id', args.accountId).eq('contact_id', args.contactId).maybeSingle()
  if (error || !conversation) throw error ?? Error('Conversación no disponible para derivación')
  if (conversation.ai_enabled === false && conversation.automation_enabled === false
    && String(conversation.ai_handoff_summary ?? '').startsWith('SOLICITUD HUMANA:')) return true
  const area = explicitlyRequestedArea(args.text)
    ?? (String(conversation.ai_handoff_area).toUpperCase() === 'FIDELIZACION' ? 'fidelizacion' : 'ventas')
  const now = new Date().toISOString()
  const update = db.from('conversations').update({
    ai_enabled: false, automation_enabled: false, ai_disabled_at: now, automation_disabled_at: now,
    ai_handed_off_at: now, ai_handoff_summary: `SOLICITUD HUMANA: ${args.text.replace(/\s+/g, ' ').slice(0, 300)}`,
  }).eq('id', args.conversationId).eq('account_id', args.accountId)
  const claim = conversation.ai_handed_off_at
    ? update.eq('ai_handed_off_at', conversation.ai_handed_off_at) : update.is('ai_handed_off_at', null)
  const { data: claimed, error: claimError } = await claim.select('id').maybeSingle()
  if (claimError) throw claimError
  if (!claimed) return true
  const { error: pauseError } = await db.from('automation_pending_executions').update({ status: 'paused' })
    .eq('account_id', args.accountId).eq('contact_id', args.contactId).eq('status', 'pending')
    .contains('context', { conversation_id: args.conversationId })
    .is('context->>manual_agent_id', null).is('context->>enrollment_sequence_id', null)
  if (pauseError) throw pauseError
  const { agentId } = await routeConversationToArea(db, args.accountId, args.conversationId, area)
  const { data: tag, error: tagError } = await db.from('tags').select('id')
    .eq('account_id', args.accountId).eq('name', 'ASESOR URGENTE').limit(1).maybeSingle()
  if (tagError) throw tagError
  // The account's existing urgent tag is reused; no parallel handoff system.
  if (tag) {
    const { error: attachError } = await db.from('contact_tags').upsert({ contact_id: args.contactId, tag_id: tag.id },
      { onConflict: 'contact_id,tag_id', ignoreDuplicates: true })
    if (attachError) throw attachError
  }
  // Respect a pre-existing manual pause. Acknowledgement is sent once, only
  // through the existing free-send/cost guard; failure never resumes the bot.
  if (conversation.ai_enabled !== false || conversation.automation_enabled !== false) {
    try {
      await engineSendText({ accountId: args.accountId, conversationId: args.conversationId,
        contactId: args.contactId, userId: args.userId,
        text: agentId ? 'Tu solicitud quedó derivada a una persona del equipo. Detuvimos los mensajes automáticos para que pueda atenderte.'
          : `Tu solicitud de atención humana quedó pendiente para el equipo. Detuvimos los mensajes automáticos.${isOpenNow() ? ' Te atenderán cuando haya una persona disponible.' : ` Nuestro horario es ${SCHEDULE_TEXT}.`}`,
      })
    } catch (sendError) { console.error('[human request] acknowledgement not sent; case remains paused', sendError) }
  }
  return true
}
