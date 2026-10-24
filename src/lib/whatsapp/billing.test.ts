import { describe, expect, it } from 'vitest'
import {
  classifyMetaPricing,
  getWhatsAppBillingPreflight,
  isConfirmedClickToWhatsAppReferral,
  normalizeMetaPricing,
} from './billing'

describe('WhatsApp billing evidence', () => {
  it('does not treat unverified text or non-ad referrals as ad origin', () => {
    expect(isConfirmedClickToWhatsAppReferral({ headline: 'anuncio' })).toBe(false)
    expect(isConfirmedClickToWhatsAppReferral({ source_type: 'post', source_id: '123' })).toBe(false)
    expect(isConfirmedClickToWhatsAppReferral({ source_type: 'ad', source_id: '123' })).toBe(true)
    expect(isConfirmedClickToWhatsAppReferral({ ctwa_clid: 'click-1' })).toBe(true)
  })

  it('keeps the customer service window distinct from CTWA free entry', () => {
    const now = Date.parse('2026-10-23T12:00:00Z')
    const snapshot = {
      last_customer_message_at: '2026-10-23T11:00:00Z',
      first_ad_referral: null,
      first_ad_referral_at: null,
    }
    const result = getWhatsAppBillingPreflight(snapshot, now)
    expect(result.service_window_open).toBe(true)
    expect(result.free_entry_window_open).toBe(false)
    expect(result.state).toBe('unknown')
    expect(result.automatic_send_allowed).toBe(false)
  })

  it('uses the confirmed monthly service allowance only when the count is known', () => {
    const now = Date.parse('2026-10-23T12:00:00Z')
    const snapshot = {
      last_customer_message_at: '2026-10-23T11:00:00Z',
      first_ad_referral: null,
      first_ad_referral_at: null,
    }

    const lastFreeSlot = getWhatsAppBillingPreflight(snapshot, now, 999)
    expect(lastFreeSlot.reason).toBe('service_free_tier')
    expect(lastFreeSlot.service_message_quota_remaining).toBe(1)
    expect(lastFreeSlot.automatic_send_allowed).toBe(true)

    const exhausted = getWhatsAppBillingPreflight(snapshot, now, 1000)
    expect(exhausted.reason).toBe('service_quota_exhausted')
    expect(exhausted.state).toBe('paid')
    expect(exhausted.estimate_note).toContain('Cupo gratis mensual agotado')
    expect(exhausted.service_message_quota_remaining).toBe(0)
    expect(exhausted.automatic_send_allowed).toBe(false)

    const unavailable = getWhatsAppBillingPreflight(snapshot, now, null)
    expect(unavailable.state).toBe('unknown')
    expect(unavailable.automatic_send_allowed).toBe(false)
  })

  it('does not use the free service allowance after the 24-hour service window closes', () => {
    const result = getWhatsAppBillingPreflight({
      last_customer_message_at: '2026-10-22T11:00:00Z',
      first_ad_referral: null,
      first_ad_referral_at: null,
    }, Date.parse('2026-10-23T12:00:00Z'), 0)
    expect(result.service_window_open).toBe(false)
    expect(result.state).toBe('unknown')
    expect(result.requires_template).toBe(true)
    expect(result.automatic_send_allowed).toBe(false)
  })

  it('allows automatic messages only within a confirmed 72-hour CTWA window', () => {
    const now = Date.parse('2026-10-23T12:00:00Z')
    const result = getWhatsAppBillingPreflight({
      last_customer_message_at: '2026-10-23T11:00:00Z',
      first_ad_referral: { source_type: 'ad', source_id: 'ad-1' },
      first_ad_referral_at: '2026-10-22T12:00:00Z',
    }, now)
    expect(result.state).toBe('free')
    expect(result.automatic_send_allowed).toBe(true)
    expect(result.estimated_cost).toBeNull()
  })

  it('classifies only Meta billable booleans as confirmed', () => {
    expect(classifyMetaPricing({ billable: false })).toBe('free')
    expect(classifyMetaPricing({ billable: true })).toBe('paid')
    expect(classifyMetaPricing({ category: 'service' })).toBe('unknown')
    expect(normalizeMetaPricing({ billable: true, category: 'utility', pricing_model: 'PMP' })).toEqual({
      billing_status: 'paid', billing_billable: true,
      billing_category: 'utility', billing_model: 'PMP',
    })
  })
})
