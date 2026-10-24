import { describe, expect, it } from 'vitest'
import { configuredKeywordMatches, decideFirstInboundKeywordRouting, hasConfiguredOpeningKeyword } from './opening-keywords'

describe('configured WhatsApp opening keywords', () => {
  it('uses the configured exact-match rule without inventing alternate keywords', () => {
    const config = { keywords: ['Quiero información de Farmacia'], match_type: 'exact' }
    expect(configuredKeywordMatches('Quiero información de Farmacia', config)).toBe(true)
    expect(configuredKeywordMatches('Hola, Quiero información de Farmacia', config)).toBe(false)
  })

  it('retains configured case-insensitive contains matching', () => {
    expect(configuredKeywordMatches('Hola, NUTRICIÓN por favor', {
      keywords: ['nutrición'], match_type: 'contains',
    })).toBe(true)
  })

  it('does not treat internal-only automations as opening routes', () => {
    expect(configuredKeywordMatches('pago validado', {
      keywords: ['pago validado'], match_type: 'exact', internal_only: true,
    })).toBe(false)
  })

  it('checks active configured automation and flow keywords together', () => {
    expect(hasConfiguredOpeningKeyword('quiero información', [], [
      { keywords: ['quiero información'], match_type: 'exact' },
    ])).toBe(true)
  })

  it('waits one minute only when an active opening keyword matches but Meta origin is not confirmed', () => {
    expect(decideFirstInboundKeywordRouting({
      firstInbound: true, keywordMatch: true, lookupSucceeded: true, adOriginConfirmed: false,
    })).toBe('wait_for_meta')
    expect(decideFirstInboundKeywordRouting({
      firstInbound: true, keywordMatch: true, lookupSucceeded: true, adOriginConfirmed: true,
    })).toBe('continue')
    expect(decideFirstInboundKeywordRouting({
      firstInbound: true, keywordMatch: false, lookupSucceeded: true, adOriginConfirmed: false,
    })).toBe('human')
  })
})
