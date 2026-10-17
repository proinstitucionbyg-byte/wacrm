import type { ChatMessage } from './types'
import { explicitlyRequestedArea } from './handoff-routing'
import { studentSupportArea } from './student-support'
import { courseKey } from '@/lib/matriculas/calendar'

/** Runs arrive newest first. A completed course must never be restarted by silence. */
export function latestCourseSequenceFinished(runs: Array<{automation_id:string;status:string}>, automations: Array<{id:string;name:string}>): boolean {
  const courses = new Set(automations.filter(automation => courseKey(automation.name)).map(automation => automation.id))
  const latest = runs.find(run => courses.has(run.automation_id))
  return latest?.status === 'success'
}

export function promisedHumanSupport(messages: ChatMessage[]): boolean {
  const latest = messages.filter(message => message.role === 'assistant').at(-1)?.content ?? ''
  const text = latest.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
  return /(?:deriv|pasar|paso|pasamos|comunicar|espera|cola).{0,100}(?:asesor|equipo|area)|(?:asesor|equipo|area).{0,100}(?:atendera|contactara|escribira|comunicara)/.test(text)
}

export function idleFollowupArea(messages: ChatMessage[], storedArea?: string | null): 'ventas' | 'fidelizacion' {
  const latest = messages.filter(message => message.role === 'user').at(-1)?.content ?? ''
  const explicit = explicitlyRequestedArea(latest) ?? studentSupportArea(latest, messages)
  if (explicit) return explicit
  const text = latest.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
  if (/\b(?:quiero|deseo|quisiera) (?:inscribirme|matricularme|comprar|estudiar)\b|\b(?:informacion|promo|precio).{0,30}(?:otro|nuevo) curso\b/.test(text)) return 'ventas'
  return storedArea?.trim().toUpperCase() === 'FIDELIZACION' ? 'fidelizacion' : 'ventas'
}
