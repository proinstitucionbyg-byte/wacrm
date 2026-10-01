import type { supabaseAdmin } from './admin-client'
import type { AutomationOption } from './defaults'
import type { ChatMessage } from './types'

type Db = ReturnType<typeof supabaseAdmin>

/** How many of the customer's latest messages are considered. */
const RECENT_USER_MESSAGES = 7

/** Words that appear in almost every message/automation and say nothing
 *  about WHICH course the customer wants. Ignored when scoring. */
const GENERIC = new Set([
  'hola', 'buenas', 'buenos', 'dias', 'tardes', 'noches', 'buen', 'dia',
  'gracias', 'favor', 'quiero', 'quisiera', 'necesito', 'interesa',
  'interesado', 'interesada', 'informacion', 'info', 'saber', 'ver',
  'curso', 'cursos', 'precio', 'precios', 'costo', 'cuesta', 'cuanto',
  'promo', 'promocion', 'super', 'tienen', 'hay', 'como', 'mas', 'por',
  'para', 'con', 'que', 'del', 'los', 'las', 'una', 'uno', 'sus', 'esta',
  'este', 'ese', 'esa', 'pero', 'tambien', 'solo',
])

function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function tokenize(s: string): string[] {
  const out = normalize(s)
    .split(/[^a-z0-9]+/)
    .filter((t) => t && !GENERIC.has(t) && (t.length >= 3 || /^\d+$/.test(t)))
  return Array.from(new Set(out))
}

/** Same word, or same 5-letter start (farmacia ~ farmaceutico). */
function sameToken(a: string, b: string): boolean {
  if (a === b) return true
  return a.length >= 5 && b.length >= 5 && a.slice(0, 5) === b.slice(0, 5)
}

function hasMatch(token: string, pool: string[]): boolean {
  return pool.some((p) => sameToken(token, p))
}

interface Doc {
  id: string
  label: string
  nameTokens: string[]
  extraTokens: string[]
}

/**
 * Pick the automations most similar to what the customer just said.
 * Reads ALL active keyword automations of the account (so new ones are
 * included automatically), scores them against the customer's last 7
 * messages (the newest counts double) and returns at most `limit`.
 * Returns [] when nothing clearly matches, so the model has nothing to
 * launch. Never throws.
 */
export async function findCandidateAutomations(
  db: Db,
  accountId: string,
  messages: ChatMessage[],
  limit = 5,
): Promise<AutomationOption[]> {
  try {
    const userMessages = messages
      .filter((m) => m.role === 'user')
      .slice(-RECENT_USER_MESSAGES)

    // token -> recency multiplier (newest message = 2, older = 1)
    const recency = new Map<string, number>()
    userMessages.forEach((m, i) => {
      const mult = i === userMessages.length - 1 ? 2 : 1
      for (const t of tokenize(m.content)) {
        recency.set(t, Math.max(recency.get(t) ?? 0, mult))
      }
    })
    const queryTokens = Array.from(recency.keys())
    if (queryTokens.length === 0) return []

    const { data, error } = await db
      .from('automations')
      .select('id, name, description, trigger_config')
      .eq('account_id', accountId)
      .eq('is_active', true)
      .eq('trigger_type', 'keyword_match')
      .limit(1000)
    if (error || !data || data.length === 0) return []

    const rows = data as Array<{
      id: string
      name: string | null
      description: string | null
      trigger_config: unknown
    }>

    const docs: Doc[] = rows.map((r) => {
      const cfg = (r.trigger_config ?? {}) as { keywords?: unknown }
      const keywords = Array.isArray(cfg.keywords)
        ? cfg.keywords.filter((k): k is string => typeof k === 'string')
        : []
      const name = (r.name ?? '').trim()
      const firstPhrase = (keywords[0] ?? '').trim().slice(0, 80)
      return {
        id: r.id,
        label: firstPhrase ? `${name} — frase: "${firstPhrase}"` : name,
        nameTokens: tokenize(name),
        extraTokens: tokenize(`${r.description ?? ''} ${keywords.join(' ')}`),
      }
    })

    const total = docs.length
    // Rare words weigh more: "farmacia" (few automations) beats "19.90" (many).
    const weight = new Map<string, number>()
    for (const q of queryTokens) {
      const df = docs.filter(
        (d) => hasMatch(q, d.nameTokens) || hasMatch(q, d.extraTokens),
      ).length
      if (df > 0) weight.set(q, Math.log(1 + total / df))
    }

    const scored = docs
      .map((d) => {
        let score = 0
        for (const q of queryTokens) {
          const w = weight.get(q)
          if (!w) continue
          const r = recency.get(q) ?? 1
          if (hasMatch(q, d.nameTokens)) score += r * 3 * w
          else if (hasMatch(q, d.extraTokens)) score += r * 1 * w
        }
        return { d, score }
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)

    return scored.map((x) => ({ id: x.d.id, name: x.d.label }))
  } catch (err) {
    console.error('[ai auto-reply] findCandidateAutomations failed:', err)
    return []
  }
}