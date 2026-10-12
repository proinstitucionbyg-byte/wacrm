import type { Automation } from '@/types'

// These are the two existing, account-owned automations. Do not create copies.
export const INITIAL_GREETING_ID = 'a2d95561-eed3-40f7-a0ae-124d6a1ce4a2'
export const RETURN_GREETING_ID = 'c853a4f9-2876-49c2-8e3a-28fecc0ea728'
const THREE_HOURS_MS = 3 * 60 * 60 * 1000

export function isGreetingAutomation(id: string): boolean {
  return id === INITIAL_GREETING_ID || id === RETURN_GREETING_ID
}

export function greetingAutomationId(previousInboundAt?: string, inboundAt?: string): string {
  if (!previousInboundAt || !inboundAt) return INITIAL_GREETING_ID
  const elapsed = Date.parse(inboundAt) - Date.parse(previousInboundAt)
  return Number.isFinite(elapsed) && elapsed >= 0 && elapsed < THREE_HOURS_MS
    ? RETURN_GREETING_ID
    : INITIAL_GREETING_ID
}

/** One return menu per active conversation. A three-hour silence starts a new cycle. */
export function shouldShowGreeting(selectedId: string, latestGreetingId?: string): boolean {
  return selectedId === INITIAL_GREETING_ID || latestGreetingId !== RETURN_GREETING_ID
}

function normalizeGreeting(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .trim().replace(/^[.!?¡¿,;:]+|[.!?¡¿,;:]+$/g, '').trim()
}

/** Only a whole greeting qualifies. A course or human request takes priority. */
export function matchesGreeting(automation: Automation, messageText?: string): boolean {
  if (!isGreetingAutomation(automation.id) || !messageText) return false
  const text = normalizeGreeting(messageText)
  if (!text || /\b(asesor|asesora|humano|persona|alguien|atencion|atiendan)\b/.test(text)) return false
  const cfg = automation.trigger_config as { keywords?: string[]; match_type?: string }
  return cfg.match_type === 'exact' && Array.isArray(cfg.keywords)
    && cfg.keywords.some((keyword) => normalizeGreeting(keyword) === text)
}
