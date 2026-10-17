import type { ChatMessage } from './types'
import { studentSupportArea } from './student-support'

export const REPETITION_HANDOFF_MARKER = '[REPETICION_SIN_RESOLVER]'

export function isWaitingForRepetitionHandoff(summary?: string | null, handedOffAt?: string | null, humanAt?: string | null): boolean {
  return Boolean(summary?.startsWith(REPETITION_HANDOFF_MARKER) && handedOffAt
    && (!humanAt || Date.parse(humanAt) <= Date.parse(handedOffAt)))
}

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

/** Five consecutive customer turns, ignoring intervening assistant replies. */
export function hasRepeatedUnresolvedMessage(messages: ChatMessage[]): boolean {
  const turns = messages.filter(message => message.role === 'user').slice(-5)
  if (turns.length < 5) return false
  const latest = normalize(turns[4].content)
  return latest.length > 0 && turns.every(message => normalize(message.content) === latest)
}

export function repetitionHandoffArea(messages: ChatMessage[], previousArea?: string | null): 'ventas' | 'fidelizacion' {
  const area = normalize(previousArea ?? '')
  if (area === 'fidelizacion' || area === 'academica') return 'fidelizacion'
  if (area === 'ventas') return 'ventas'
  for (const message of messages) {
    if (message.role === 'user' && studentSupportArea(message.content, messages)) return 'fidelizacion'
  }
  return 'ventas'
}
