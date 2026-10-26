import type { ChatMessage } from './types'
import { explicitlyRequestedArea } from './handoff-routing'
import { studentSupportArea } from './student-support'
import { isSavedCourseName } from '@/lib/automations/course-detour'

interface FollowupAutomation { id: string; name: string; trigger_config?: unknown }
interface FollowupRun { automation_id: string; status: string; created_at?: string; trigger_event?: string }

function isCourseRoot(automation: FollowupAutomation): boolean {
  // Actual root metadata separates the course from requested materials that
  // also contain its name. Legacy callers without metadata use the saved aliases.
  return automation.trigger_config == null ? isSavedCourseName(automation.name)
    : (automation.trigger_config as Record<string, unknown>).sales_window_close === true
}

/** Runs arrive newest first. A completed course must never be restarted by silence. */
export function latestCourseSequenceFinished(runs: FollowupRun[], automations: FollowupAutomation[]): boolean {
  const courses = new Set(automations.filter(isCourseRoot).map(automation => automation.id))
  const latest = runs.find(run => courses.has(run.automation_id))
  return latest?.status === 'success'
}

/** A later question does not undo the customer's decision to enter payment.
 * Direct inbound answers still run; silence must not replace payment with a menu.
 * A genuine new course opening releases the old stage; linked returns do not. */
export function hasRecentPaymentStage(runs: FollowupRun[], automations: FollowupAutomation[], now: number): boolean {
  const byId = new Map(automations.map(automation => [automation.id, automation]))
  const payment = runs.find(run => {
    const automation = byId.get(run.automation_id)
    const age = now - Date.parse(run.created_at ?? '')
    return ['success', 'partial'].includes(run.status) && age >= 0 && age < 24 * 60 * 60 * 1000
      && Boolean(automation && (automation.name === 'YAPE O PLIN'
        || (automation.trigger_config as Record<string, unknown> | null)?.payment_followup === true))
  })
  if (!payment) return false
  return !runs.some(run => {
    const automation = byId.get(run.automation_id)
    return ['success', 'partial'].includes(run.status) && automation && isCourseRoot(automation)
      && /^keyword_match(?:$|:)/.test(run.trigger_event ?? '')
      && Date.parse(run.created_at ?? '') > Date.parse(payment.created_at ?? '')
      && Date.parse(run.created_at ?? '') <= now
  })
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
