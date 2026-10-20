import { describe, expect, it } from 'vitest'
import { canAutoReplyToInboundImage } from './inbound-image-routing'

describe('inbound image AI routing', () => {
  it('leaves DNI and payment receipts to their deterministic handlers', () => {
    expect(canAutoReplyToInboundImage({ status: 'pending_review', category: 'identity_document' })).toBe(false)
    expect(canAutoReplyToInboundImage({ status: 'pending_review', category: 'payment_receipt' })).toBe(false)
  })

  it('still permits ordinary images and text-only messages', () => {
    expect(canAutoReplyToInboundImage({ status: 'pending_review', category: 'other' })).toBe(true)
    expect(canAutoReplyToInboundImage(null)).toBe(true)
  })
})
