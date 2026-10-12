import { describe, expect, it } from 'vitest'
import type { Automation } from '@/types'
import { greetingAutomationId, INITIAL_GREETING_ID, matchesGreeting, RETURN_GREETING_ID } from './greeting-continuity'

describe('the two existing greeting automations', () => {
  const current = '2026-10-12T15:00:00.000Z'

  it('uses the initial greeting for the first contact and at three hours', () => {
    expect(greetingAutomationId(undefined, current)).toBe(INITIAL_GREETING_ID)
    expect(greetingAutomationId('2026-10-12T12:00:00.000Z', current)).toBe(INITIAL_GREETING_ID)
  })

  it('uses Hola nuevamente before three hours', () => {
    expect(greetingAutomationId('2026-10-12T12:01:00.000Z', current)).toBe(RETURN_GREETING_ID)
  })

  it('accepts greeting punctuation but not a specific request', () => {
    const automation = { id: RETURN_GREETING_ID, trigger_config: { match_type: 'exact', keywords: ['hola', 'buen día', 'quiero hablar con alguien', 'necesito atención'] } } as Automation
    expect(matchesGreeting(automation, '¡HOLA!')).toBe(true)
    expect(matchesGreeting(automation, 'Hola!')).toBe(true)
    expect(matchesGreeting(automation, 'Buen dia.')).toBe(true)
    expect(matchesGreeting(automation, 'Hola, quiero información de Farmacia')).toBe(false)
    expect(matchesGreeting(automation, 'Quiero hablar con alguien')).toBe(false)
    expect(matchesGreeting(automation, 'Necesito atención')).toBe(false)
  })
})
