import type { ImageAnalysis } from './analyze-image'

/**
 * DNI and payment photos already have deterministic, auditable handlers.
 * Sending either one to the free-form reply model can make it repeat payment
 * instructions while the registration collector is processing the evidence.
 */
export function canAutoReplyToInboundImage(
  analysis: ImageAnalysis | null,
): boolean {
  return analysis?.category !== 'identity_document'
    && analysis?.category !== 'payment_receipt'
}
