import type { ChatMessage } from './types'
import { explicitlyRequestedArea } from './handoff-routing'
import { studentSupportArea } from './student-support'

export function idleFollowupArea(messages: ChatMessage[], storedArea?: string | null): 'ventas' | 'fidelizacion' {
  const latest = messages.filter(message => message.role === 'user').at(-1)?.content ?? ''
  const explicit = explicitlyRequestedArea(latest) ?? studentSupportArea(latest, messages)
  if (explicit) return explicit
  const text = latest.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
  if (/\b(?:quiero|deseo|quisiera) (?:inscribirme|matricularme|comprar|estudiar)\b|\b(?:informacion|promo|precio).{0,30}(?:otro|nuevo) curso\b/.test(text)) return 'ventas'
  return storedArea?.trim().toUpperCase() === 'FIDELIZACION' ? 'fidelizacion' : 'ventas'
}
