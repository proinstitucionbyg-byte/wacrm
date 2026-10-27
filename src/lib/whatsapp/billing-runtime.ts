import type { SupabaseClient } from '@supabase/supabase-js'
import {
  getWhatsAppBillingPreflight,
  type WhatsAppBillingPreflight,
} from './billing'

export const URGENT_ADVISER_TAG = 'ASESOR URGENTE'

export class WhatsAppAutomaticBillingBlockedError extends Error {
  readonly code = 'whatsapp_billing_not_confirmed_free'
  constructor() {
    super('Envío automático pausado: Meta no confirma una ventana gratuita vigente. Requiere revisión de una asesora.')
    this.name = 'WhatsAppAutomaticBillingBlockedError'
  }
}

export async function readConversationBillingPreflight(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
): Promise<WhatsAppBillingPreflight> {
  const { data, error } = await db.from('conversations')
    .select('last_customer_message_at,first_ad_referral,first_ad_referral_at')
    .eq('id', conversationId)
    .eq('account_id', accountId)
    .maybeSingle()
  if (error || !data) throw new Error('No se pudo verificar el estado de facturación de esta conversación.')
  const { data: config, error: configError } = await db.from('whatsapp_config')
    .select('phone_number_id').eq('account_id', accountId).maybeSingle()
  if (configError || !config?.phone_number_id) throw new Error('No se pudo verificar el número empresarial de WhatsApp.')
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString().slice(0, 10)
  const { count, error: usageError } = await db.from('whatsapp_service_message_reservations')
    .select('id', { count: 'exact', head: true })
    .eq('phone_number_id', config.phone_number_id)
    .eq('month_start', monthStart)
    .in('status', ['reserved', 'sent', 'delivered'])
  return getWhatsAppBillingPreflight(data, Date.now(), usageError ? null : count ?? 0)
}

export interface WhatsAppAutomaticSendPermit {
  preflight: WhatsAppBillingPreflight
  reservationId: string | null
}

export async function reserveWhatsAppServiceMessage(
  db: SupabaseClient,
  args: { accountId: string; phoneNumberId: string; allowOverQuota?: boolean },
): Promise<{ reservationId: string | null; freeTierAvailable: boolean; used: number; remaining: number }> {
  const { data, error } = await db.rpc('reserve_whatsapp_service_message', {
    p_account_id: args.accountId,
    p_phone_number_id: args.phoneNumberId,
    p_allow_over_quota: args.allowOverQuota === true,
  })
  if (error) throw new Error(`No se pudo reservar el cupo mensual de mensajes: ${error.message}`)
  const row = (Array.isArray(data) ? data[0] : data) as {
    reservation_id?: string | null
    free_tier_available?: boolean
    used?: number
    remaining?: number
  } | null
  if (!row) throw new Error('Meta no devolvió el estado del cupo mensual de servicio.')
  return {
    reservationId: row.reservation_id ?? null,
    freeTierAvailable: row.free_tier_available === true,
    used: Number(row.used ?? 0),
    remaining: Number(row.remaining ?? 0),
  }
}

export async function markWhatsAppServiceMessageSent(
  db: SupabaseClient,
  reservationId: string | null,
  messageId: string,
) {
  if (!reservationId) return
  const { error } = await db.from('whatsapp_service_message_reservations').update({
    status: 'sent', message_id: messageId, updated_at: new Date().toISOString(),
  }).eq('id', reservationId).eq('status', 'reserved')
  if (error) console.error('[whatsapp-billing] could not link service quota reservation:', error.message)
}

export async function releaseWhatsAppServiceMessageReservation(
  db: SupabaseClient,
  reservationId: string | null,
) {
  if (!reservationId) return
  const { error } = await db.from('whatsapp_service_message_reservations').update({
    status: 'failed', updated_at: new Date().toISOString(),
  }).eq('id', reservationId).eq('status', 'reserved')
  if (error) console.error('[whatsapp-billing] could not release failed service quota reservation:', error.message)
}

async function sendToUrgentHumanQueue(
  db: SupabaseClient,
  args: { accountId: string; conversationId: string; contactId?: string },
) {
  const disabledAt = new Date().toISOString()
  const { data: conversation, error: conversationError } = await db.from('conversations')
    .select('id,contact_id,user_id,ai_enabled,automation_enabled')
    .eq('id', args.conversationId)
    .eq('account_id', args.accountId)
    .maybeSingle()
  if (conversationError || !conversation) throw new Error('No se encontró la conversación para pausarla de forma segura.')

  if (conversation.ai_enabled !== false || conversation.automation_enabled !== false) {
    const { error } = await db.from('conversations').update({
      ai_enabled: false,
      automation_enabled: false,
      automation_disabled_at: disabledAt,
    }).eq('id', args.conversationId).eq('account_id', args.accountId)
    if (error) throw error
  }

  const contactId = args.contactId ?? conversation.contact_id
  if (!contactId) return
  const { data: existingTag, error: tagError } = await db.from('tags')
    .select('id').eq('account_id', args.accountId).eq('name', URGENT_ADVISER_TAG)
    .limit(1).maybeSingle()
  if (tagError) throw tagError

  let tagId = existingTag?.id as string | undefined
  if (!tagId) {
    const { data: created, error } = await db.from('tags').insert({
      user_id: conversation.user_id,
      account_id: args.accountId,
      name: URGENT_ADVISER_TAG,
      color: '#ef4444',
      kind: 'access',
      audience: { users: [], areas: ['VENTAS'], roles: ['owner', 'admin', 'coordinator'] },
    }).select('id').single()
    if (error) throw error
    tagId = created?.id as string | undefined
  }
  if (!tagId) throw new Error('No se pudo preparar la etiqueta de asesoría urgente.')
  const { error: attachError } = await db.from('contact_tags').upsert(
    { contact_id: contactId, tag_id: tagId },
    { onConflict: 'contact_id,tag_id', ignoreDuplicates: true },
  )
  if (attachError) throw attachError
}

/** Fail closed for automated WhatsApp sends unless Meta's CTWA evidence
 * proves the 72-hour free-entry window is currently open. */
export async function assertAutomaticWhatsAppSendIsFree(
  db: SupabaseClient,
  args: {
    accountId: string
    conversationId: string
    contactId?: string
    /** Set only by the durable, server-owned first-keyword queue after its
     * one-minute wait. The outgoing message remains billing_status=unknown. */
    keywordOpeningFallback?: boolean
    /** Template messages do not use the 1,000-message free service allowance. */
    messageCategory?: 'service' | 'template'
  },
): Promise<WhatsAppAutomaticSendPermit> {
  const preflight = await readConversationBillingPreflight(db, args.accountId, args.conversationId)
  // Economic coverage is not permission to send free-form content. Even an
  // eligible 72-hour ad window cannot bypass the owner's strict 24-hour rule.
  if (args.messageCategory !== 'template' && !preflight.service_window_open) {
    throw new Error('Ventana de atención de 24 horas vencida: requiere plantilla aprobada')
  }
  if (preflight.free_entry_window_open) {
    // Confirmed click-to-WhatsApp free-entry coverage takes precedence over
    // the monthly service-message allowance; do not debit that allowance.
    return { preflight, reservationId: null }
  }

  if (args.keywordOpeningFallback) {
    // The one-minute keyword exception permits an unconfirmed-origin opening,
    // not a paid send. Keep the usual service-window and monthly-free-quota
    // gates in place; the eventual Meta status remains the billing authority.
    if (args.messageCategory !== 'template' && preflight.service_window_open) {
      const { data: config, error: configError } = await db.from('whatsapp_config').select('phone_number_id')
        .eq('account_id', args.accountId).maybeSingle()
      if (!configError && config?.phone_number_id) {
        const reservation = await reserveWhatsAppServiceMessage(db, {
          accountId: args.accountId, phoneNumberId: config.phone_number_id,
        })
        if (reservation.reservationId && reservation.freeTierAvailable) {
          return { preflight, reservationId: reservation.reservationId }
        }
      }
    }
    await sendToUrgentHumanQueue(db, args)
    throw new WhatsAppAutomaticBillingBlockedError()
  }

  if (args.messageCategory !== 'template' && preflight.service_window_open) {
    const { data: config, error: configError } = await db.from('whatsapp_config')
      .select('phone_number_id').eq('account_id', args.accountId).maybeSingle()
    if (configError || !config?.phone_number_id) throw new WhatsAppAutomaticBillingBlockedError()
    const reservation = await reserveWhatsAppServiceMessage(db, {
      accountId: args.accountId,
      phoneNumberId: config.phone_number_id,
    })
    if (reservation.reservationId && reservation.freeTierAvailable) {
      return { preflight, reservationId: reservation.reservationId }
    }
  }

  await sendToUrgentHumanQueue(db, args)
  throw new WhatsAppAutomaticBillingBlockedError()
}

export async function gateAutomaticWhatsAppConversation(
  db: SupabaseClient,
  args: { accountId: string; conversationId: string; contactId?: string },
): Promise<{ allowed: true; preflight: WhatsAppBillingPreflight } | { allowed: false; preflight: null }> {
  let preflight: WhatsAppBillingPreflight
  try {
    preflight = await readConversationBillingPreflight(db, args.accountId, args.conversationId)
  } catch {
    // Schema/evidence errors fail closed rather than sending unclassified traffic.
    await sendToUrgentHumanQueue(db, args).catch((handoffError) => {
      console.error('[whatsapp-billing] unable to pause and route uncertain send:', handoffError)
    })
    return { allowed: false, preflight: null }
  }
  if (preflight.automatic_send_allowed) return { allowed: true, preflight }

  await sendToUrgentHumanQueue(db, args)
  return { allowed: false, preflight: null }
}
