import { normalizeMetaPricing } from './billing'

export interface WhatsAppDeliveryStatus {
  id: string
  status: string
  timestamp: string
  recipient_id: string
  pricing?: {
    billable?: boolean
    type?: string
    category?: string
    pricing_model?: string
  }
  errors?: Array<{ code?: number; title?: string; message?: string; error_data?: { details?: string } }>
}

/** Keep Meta's actual failure reason without changing the message text. */
export function deliveryStatusPatch(status: WhatsAppDeliveryStatus) {
  const error = status.errors?.[0]
  const confirmedDelivery = status.status === 'delivered' || status.status === 'read'
  const timestamp = Number(status.timestamp)
  const eventAt = Number.isFinite(timestamp) ? new Date(timestamp * 1000).toISOString() : null
  const pricingPatch = status.pricing && confirmedDelivery
    ? {
        ...normalizeMetaPricing(status.pricing),
        ...(typeof status.pricing.billable === 'boolean' && eventAt
          ? { billing_confirmed_at: eventAt }
          : {}),
      }
    : {}
  return {
    status: status.status,
    delivery_error: status.status === 'failed' && error ? {
      code: error.code ?? null,
      title: (error.title ?? '').slice(0, 300),
      details: (error.error_data?.details ?? error.message ?? '').slice(0, 1000),
    } : null,
    ...(status.recipient_id ? { billing_recipient_id: status.recipient_id } : {}),
    ...(status.status === 'delivered' && eventAt ? { billing_delivered_at: eventAt } : {}),
    ...pricingPatch,
  }
}
