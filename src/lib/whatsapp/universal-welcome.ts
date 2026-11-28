import type { SupabaseClient } from '@supabase/supabase-js'
import type { dispatchInboundThroughCrm } from './inbound-dispatch'
import { engineSendText } from '@/lib/automations/meta-send'
import { readDeliveryReference } from '@/lib/automations/delivery-reference'
import { withSessionInbound } from './session-inbound-context'
import { isLikelyAutomatedInbound } from '@/lib/ai/automated-inbound'
import { isExplicitSalesDecline } from '@/lib/ai/sales-decline'
import { handleExplicitHumanRequest } from '@/lib/ai/explicit-human-request'
import { inboundRoutingText } from '@/lib/automations/routing-text'
import { HUMAN_PAUSE_MS } from '@/lib/ai/human-pause'
import { isConfirmedClickToWhatsAppReferral } from './billing'
import {cloudBusinessRouteEnabled,prepareCloudBusinessRoute,CLOUD_BUSINESS_OPENING_DELAY_MS} from './cloud-business-route'

export const NEW_NUMBER_WELCOME_TEXT = '👋🏻 ¡Bienvenid@ a *INSTICRECE*! 💙 Gracias por comunicarte con nosotros.\n\nEn breve, nuestro equipo se pondrá en contacto contigo para resolver tus consultas y brindarte la asistencia que necesites. 👩🏻‍💻📚\n\n¡Si creces tú, crecemos nosotros!'
export const NEW_NUMBER_WELCOME_DELAY_MS = 30_000
type Input = Parameters<typeof dispatchInboundThroughCrm>[0]
type Payload = Omit<Input, 'db' | 'conversation' | 'welcomeContinuation'>
type Welcome = { id: string; account_id: string; conversation_id: string; contact_id: string;
  payload: Payload; state: string; message_reference: string | null; run_at: string; created_at: string }

export function welcomeCanRun(controls: Input['conversation'], now = Date.now()) {
  return controls.automation_enabled !== false
    && (!controls.last_human_message_at || now - Date.parse(controls.last_human_message_at) >= HUMAN_PAUSE_MS)
}

/** Atomic reservation across conversations and linked lines, before any reply engine. */
export async function gateNewNumberWelcome(args: Input): Promise<'held' | 'enrolled' | 'legacy'> {
  const { db } = args
  if (args.preparedCommand) return 'legacy'
  const text = inboundRoutingText(args.contentText, args.audioTranscript)
  if (isLikelyAutomatedInbound(text)) return 'legacy'
  const { db: _db, conversation: _conversation, welcomeContinuation: _continuation, ...payload } = args
  void _db; void _conversation; void _continuation
  const reserved = await db.rpc('reserve_new_number_welcome', {
    p_account_id: args.accountId, p_conversation_id: args.conversationId,
    p_provider_id: args.messageId, p_payload: payload,
  })
  if (reserved.error) throw new Error('No se pudo comprobar la bienvenida inicial; no se iniciarán dos rutas.')
  if (!reserved.data?.enrolled) return 'legacy'
  if (reserved.data.state === 'done') return 'enrolled'
  const id = reserved.data.id as string
  const human = await handleExplicitHumanRequest(db, {
    accountId: args.accountId, conversationId: args.conversationId, contactId: args.contactId,
    userId: args.userId, text, replyId: args.interactiveReplyId ?? null,
  })
  if (human || isExplicitSalesDecline(text) || !welcomeCanRun(args.conversation)) {
    await checked(db.from('whatsapp_new_number_welcomes').update({ state: 'cancelled', reason: 'manual_pause_or_optout' }).eq('id', id).eq('account_id', args.accountId).neq('state', 'done'))
    return 'held'
  }
  if (!reserved.data.created) return 'held'
  try {
    let reference: string
    if (args.channel === 'cloud' && !args.hasConfirmedAdOrigin) {
      // Reuse the existing authorized support line, retaining the real Cloud source.
      const queued = await db.rpc('enqueue_cloud_support_opening', {
        p_account_id: args.accountId, p_conversation_id: args.conversationId,
        p_provider_id: args.messageId, p_body: reserved.data.body, p_options: [],
      })
      if (queued.error || !queued.data?.job_id) throw new Error('No hay una línea de soporte disponible para la bienvenida.')
      reference = `waweb-job:${queued.data.job_id}`
    } else {
      const sent = await engineSendText({ accountId: args.accountId, userId: args.userId,
        contactId: args.contactId, conversationId: args.conversationId, text: reserved.data.body,
        idempotencyKey: `new-number-welcome:${id}` })
      reference = sent.whatsapp_message_id
    }
    await checked(db.from('whatsapp_new_number_welcomes').update({ state: 'waiting_delivery', message_reference: reference,
      run_at: new Date().toISOString() }).eq('id', id).eq('state', 'sending'))
  } catch (error) {
    await checked(db.from('whatsapp_new_number_welcomes').update({ state: 'needs_review', reason: 'welcome_send_not_confirmed' }).eq('id', id))
    throw error
  }
  return 'held'
}

async function checked(query: PromiseLike<{ error: unknown }>) { const result = await query; if (result.error) throw result.error }

/** Called by the existing five-second cron; no additional executor or browser timer. */
export async function drainNewNumberWelcomes(db: SupabaseClient): Promise<number> {
  // A crash at an external-send boundary is uncertain, never an automatic resend.
  await checked(db.from('whatsapp_new_number_welcomes').update({ state: 'needs_review', reason: 'interrupted_send_or_route' })
    .in('state', ['sending', 'routing']).lt('updated_at', new Date(Date.now() - 180_000).toISOString()))
  const due = await db.from('whatsapp_new_number_welcomes').select('*')
    .in('state', ['waiting_delivery', 'waiting_route']).lte('run_at', new Date().toISOString()).limit(30)
  if (due.error) throw due.error
  let processed = 0
  for (const row of (due.data ?? []) as Welcome[]) {
    const conversation = await db.from('conversations').select('ai_enabled,automation_enabled,last_human_message_at,first_ad_referral,whatsapp_support_line_key')
      .eq('id', row.conversation_id).eq('account_id', row.account_id).eq('contact_id', row.contact_id).maybeSingle()
    if (conversation.error) throw conversation.error
    if (!conversation.data || !welcomeCanRun(conversation.data)) {
      await checked(db.from('whatsapp_new_number_welcomes').update({ state: 'cancelled', reason: 'manual_pause' }).eq('id', row.id).eq('state', row.state)); continue
    }
    if (row.state === 'waiting_delivery') {
      if (!row.message_reference) continue
      const delivery = await readDeliveryReference(db, row.account_id, row.conversation_id, row.message_reference)
      if (delivery.error) continue
      if (['failed', 'cancelled', 'needs_review'].includes(delivery.status ?? '')) {
        await checked(db.from('whatsapp_new_number_welcomes').update({ state: 'needs_review', reason: 'welcome_delivery_failed' }).eq('id', row.id).eq('state', row.state))
      } else if (['accepted', 'sent', 'delivered', 'read'].includes(delivery.status ?? '')) {
        const delay=row.payload.channel==='cloud'&&!conversation.data.whatsapp_support_line_key
          &&await cloudBusinessRouteEnabled(db,row.account_id)?CLOUD_BUSINESS_OPENING_DELAY_MS:NEW_NUMBER_WELCOME_DELAY_MS
        await checked(db.from('whatsapp_new_number_welcomes').update({ state: 'waiting_route',
          run_at: new Date(Date.now() + delay).toISOString() }).eq('id', row.id).eq('state', row.state))
      }
      continue
    }
    const claim = await db.from('whatsapp_new_number_welcomes').update({ state: 'routing', updated_at: new Date().toISOString() })
      .eq('id', row.id).eq('state', 'waiting_route').select('id').maybeSingle()
    if (claim.error) throw claim.error
    if (!claim.data) continue
    try {
      const { dispatchInboundThroughCrm: dispatch } = await import('./inbound-dispatch')
      const input: Input = { ...row.payload, db, welcomeContinuation: true, conversation: conversation.data,
        hasConfirmedAdOrigin: row.payload.hasConfirmedAdOrigin || isConfirmedClickToWhatsAppReferral(conversation.data.first_ad_referral) }
      if(input.channel==='cloud'&&!conversation.data.whatsapp_support_line_key&&await cloudBusinessRouteEnabled(db,row.account_id)){
        await prepareCloudBusinessRoute(db,input)
      }
      if (input.channel === 'session') {
        const source = await db.from('messages').select('id,whatsapp_session_line_key').eq('conversation_id', row.conversation_id)
          .eq('message_id', input.messageId).eq('sender_type', 'customer').single()
        if (source.error || !source.data.whatsapp_session_line_key) throw new Error('No se encontró el origen de la bienvenida.')
        const receipt = await db.from('whatsapp_session_inbound_receipts').select('provider_message_id')
          .eq('account_id', row.account_id).eq('message_row_id', source.data.id).eq('line_key', source.data.whatsapp_session_line_key).single()
        if (receipt.error) throw receipt.error
        await withSessionInbound({ accountId: row.account_id, conversationId: row.conversation_id,
          messageRowId: source.data.id, lineKey: source.data.whatsapp_session_line_key, providerMessageId: receipt.data.provider_message_id }, () => dispatch(input))
      } else await dispatch(input)
      await checked(db.from('whatsapp_new_number_welcomes').update({ state: 'done', updated_at: new Date().toISOString() }).eq('id', row.id).eq('state', 'routing'))
      processed++
    } catch {
      await checked(db.from('whatsapp_new_number_welcomes').update({ state: 'needs_review', reason: 'route_not_confirmed' }).eq('id', row.id).eq('state', 'routing'))
    }
  }
  return processed
}
