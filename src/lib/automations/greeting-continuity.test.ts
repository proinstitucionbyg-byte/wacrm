import { describe, expect, it } from 'vitest'
import type { Automation } from '@/types'
import { greetingAutomationId, INITIAL_GREETING_ID, matchesGreeting, RETURN_GREETING_ID, shouldShowGreeting } from './greeting-continuity'

describe('the two existing greeting automations', () => {
  const current = '2026-10-12T15:00:00.000Z'

  it('uses the initial greeting for the first contact and at three hours', () => {
    expect(greetingAutomationId(undefined, current)).toBe(INITIAL_GREETING_ID)
    expect(greetingAutomationId('2026-10-12T12:00:00.000Z', current)).toBe(INITIAL_GREETING_ID)
  })

  it('uses Hola nuevamente before three hours', () => {
    expect(greetingAutomationId('2026-10-12T12:01:00.000Z', current)).toBe(RETURN_GREETING_ID)
  })

  it('shows the return menu once per active cycle, then resets after silence', () => {
    expect(shouldShowGreeting(RETURN_GREETING_ID, INITIAL_GREETING_ID)).toBe(true)
    expect(shouldShowGreeting(RETURN_GREETING_ID, RETURN_GREETING_ID)).toBe(false)
    expect(shouldShowGreeting(INITIAL_GREETING_ID, RETURN_GREETING_ID)).toBe(true)
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
  it('recognizes the generic opener supplied by ads without consuming course choices',()=>{
    const automation={id:INITIAL_GREETING_ID,trigger_config:{match_type:'exact',keywords:['hola']}} as Automation
    expect(matchesGreeting(automation,'¡Hola! Quiero más información')).toBe(true)
    expect(matchesGreeting(automation,'Hola quiero informacion de nutricion')).toBe(false)
  })
})
