export interface WhatsAppDeliveryStatus {
  id: string
  status: string
  timestamp: string
  recipient_id: string
  errors?: Array<{ code?: number; title?: string; message?: string; error_data?: { details?: string } }>
}

/** Keep Meta's actual failure reason without changing the message text. */
export function deliveryStatusPatch(status: WhatsAppDeliveryStatus) {
  const error = status.errors?.[0]
  return {
    status: status.status,
    delivery_error: status.status === 'failed' && error ? {
      code: error.code ?? null,
      title: (error.title ?? '').slice(0, 300),
      details: (error.error_data?.details ?? error.message ?? '').slice(0, 1000),
    } : null,
  }
}
