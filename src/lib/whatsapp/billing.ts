export type WhatsAppBillingState = 'free' | 'paid' | 'unknown'

export interface MetaPricingEvidence {
  billable?: unknown
  type?: unknown
  category?: unknown
  pricing_model?: unknown
}

export interface ConversationBillingSnapshot {
  last_customer_message_at: string | null
  first_ad_referral: Record<string, unknown> | null
  first_ad_referral_at: string | null
}

export interface WhatsAppBillingPreflight {
  state: WhatsAppBillingState
  reason: 'ctwa_free_entry' | 'service_free_tier' | 'service_quota_exhausted' | 'may_be_billable' | 'no_customer_window'
  service_window_until: string | null
  free_entry_window_until: string | null
  service_window_open: boolean
  free_entry_window_open: boolean
  service_message_quota_limit: number
  service_message_quota_used: number | null
  service_message_quota_remaining: number | null
  requires_template: boolean
  estimated_cost: number | null
  currency: string | null
  estimate_note: string
  automatic_send_allowed: boolean
}

function safeString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 120) : null
}

/** Only signed Meta referral identifiers can confirm a click-to-WhatsApp ad. */
export function isConfirmedClickToWhatsAppReferral(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const referral = value as Record<string, unknown>
  const sourceType = safeString(referral.source_type)?.toLowerCase()
  const sourceId = safeString(referral.source_id) ?? safeString(referral.ad_id)
  return Boolean(safeString(referral.ctwa_clid) || (sourceType === 'ad' && sourceId))
}

export function classifyMetaPricing(pricing: MetaPricingEvidence | null | undefined): WhatsAppBillingState {
  if (pricing?.billable === false) return 'free'
  if (pricing?.billable === true) return 'paid'
  return 'unknown'
}

function plusHours(value: string | null, hours: number): number | null {
  if (!value) return null
  const time = Date.parse(value)
  return Number.isFinite(time) ? time + hours * 60 * 60 * 1000 : null
}

/**
 * The 24-hour customer-service window and the separate 72-hour CTWA free
 * entry window are reported independently. We do not infer a free message
 * from the 24-hour window; only Meta's signed `billable:false` confirms it.
 */
export function getWhatsAppBillingPreflight(
  snapshot: ConversationBillingSnapshot,
  now = Date.now(),
  serviceMessagesUsed: number | null = null,
): WhatsAppBillingPreflight {
  const serviceUntil = plusHours(snapshot.last_customer_message_at, 24)
  const adUntil = isConfirmedClickToWhatsAppReferral(snapshot.first_ad_referral)
    ? plusHours(snapshot.first_ad_referral_at, 72)
    : null
  const serviceOpen = serviceUntil !== null && now < serviceUntil
  const freeEntryOpen = adUntil !== null && now < adUntil
  const serviceQuotaRemaining = serviceMessagesUsed === null
    ? null
    : Math.max(0, 1000 - Math.max(0, serviceMessagesUsed))
  const serviceQuotaOpen = serviceOpen && serviceQuotaRemaining !== null && serviceQuotaRemaining > 0
  const serviceQuotaExhausted = serviceOpen && serviceQuotaRemaining === 0
  return {
    state: freeEntryOpen || serviceQuotaOpen ? 'free' : serviceQuotaExhausted ? 'paid' : 'unknown',
    reason: freeEntryOpen ? 'ctwa_free_entry'
      : serviceOpen && serviceQuotaRemaining === 0 ? 'service_quota_exhausted'
        : serviceQuotaOpen ? 'service_free_tier'
          : serviceOpen ? 'may_be_billable' : 'no_customer_window',
    service_window_until: serviceUntil === null ? null : new Date(serviceUntil).toISOString(),
    free_entry_window_until: adUntil === null ? null : new Date(adUntil).toISOString(),
    service_window_open: serviceOpen,
    free_entry_window_open: freeEntryOpen,
    service_message_quota_limit: 1000,
    service_message_quota_used: serviceMessagesUsed,
    service_message_quota_remaining: serviceQuotaRemaining,
    requires_template: !serviceOpen,
    estimated_cost: null,
    currency: null,
    estimate_note: freeEntryOpen
      ? 'Meta confirma la ventana gratuita de entrada publicitaria; el costo final se confirma en el webhook.'
      : serviceQuotaExhausted
        ? 'Cupo gratis mensual agotado: Meta clasifica el siguiente mensaje de servicio como de pago; importe exacto no disponible sin la tarifa oficial.'
        : 'No hay una tarifa oficial configurada para estimar este envío. El costo queda por confirmar.',
    automatic_send_allowed: freeEntryOpen || serviceQuotaOpen,
  }
}

export function normalizeMetaPricing(pricing: MetaPricingEvidence | null | undefined) {
  const result: Record<string, unknown> = {}
  if (typeof pricing?.billable === 'boolean') {
    result.billing_status = classifyMetaPricing(pricing)
    result.billing_billable = pricing.billable
  }
  const type = safeString(pricing?.type)
  const category = safeString(pricing?.category)
  const model = safeString(pricing?.pricing_model)
  if (type) result.billing_type = type
  if (category) result.billing_category = category
  if (model) result.billing_model = model
  return result
}
