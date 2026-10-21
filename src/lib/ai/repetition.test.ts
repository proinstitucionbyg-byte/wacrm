import { describe, it, expect } from 'vitest'
import { hasRepeatedUnresolvedMessage, isWaitingForRepetitionHandoff, repetitionHandoffArea } from './repetition'
import type { ChatMessage } from './types'

describe('unresolved repetition guard', () => {
  it('keeps follow-ups paused until a human attends the repetition handoff', () => {
    const summary = '[REPETICION_SIN_RESOLVER] Cinco mensajes iguales.'
    expect(isWaitingForRepetitionHandoff(summary,'2026-10-17T18:00:00Z')).toBe(true)
    expect(isWaitingForRepetitionHandoff(summary,'2026-10-17T18:00:00Z','2026-10-17T17:00:00Z')).toBe(true)
    expect(isWaitingForRepetitionHandoff(summary,'2026-10-17T18:00:00Z','2026-10-17T18:01:00Z')).toBe(false)
    expect(isWaitingForRepetitionHandoff('Other handoff','2026-10-17T18:00:00Z')).toBe(false)
  })
  const repeats = (count: number): ChatMessage[] => Array.from({length:count}, () =>
    [{role:'user' as const,content:'Mi expediente XYZ'}, {role:'assistant' as const,content:'¿Qué necesitas?'}]).flat().slice(0,-1)
  it('waits until the fifth customer repetition', () => {
    expect(hasRepeatedUnresolvedMessage(repeats(4))).toBe(false)
    expect(hasRepeatedUnresolvedMessage(repeats(5))).toBe(true)
    expect(hasRepeatedUnresolvedMessage(repeats(6))).toBe(true)
  })
  it('ignores case and punctuation but resets for a new customer answer', () => {
    const messages = repeats(4)
    messages.push({role:'user',content:'¡MI EXPEDIENTE xyz!'} )
    expect(hasRepeatedUnresolvedMessage(messages)).toBe(true)
    messages.push({role:'user',content:'Ya lo solucioné, gracias'})
    expect(hasRepeatedUnresolvedMessage(messages)).toBe(false)
  })
  it('keeps the existing area and identifies academic support from customer history', () => {
    expect(repetitionHandoffArea(repeats(5),'FIDELIZACION')).toBe('fidelizacion')
    expect(repetitionHandoffArea(repeats(5),'VENTAS')).toBe('ventas')
    expect(repetitionHandoffArea([{role:'user',content:'Ya estoy estudiando'}, {role:'user',content:'No puedo ingresar a mi clase'},...repeats(5)])).toBe('fidelizacion')
    expect(repetitionHandoffArea(repeats(5))).toBe('ventas')
  })
})
