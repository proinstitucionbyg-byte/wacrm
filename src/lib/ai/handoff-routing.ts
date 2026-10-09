import type { supabaseAdmin } from './admin-client'
import { derivePresence, type StoredPresence } from '@/lib/presence'

type Db = ReturnType<typeof supabaseAdmin>

export interface AreaAgentResult {
  /** User id of the chosen agent, or null when nobody in the area is connected. */
  agentId: string | null
}

/**
 * Pick the agent of `area` who should receive a handed-off conversation.
 * Prefers members who are 'online'; if none, 'away' (they have the CRM
 * open and still get the notification). Among the candidates it picks the
 * one with the fewest non-closed conversations assigned. Returns
 * `{ agentId: null }` when nobody in the area is connected. Never throws.
 */
export async function findConnectedAgentForArea(
  db: Db,
  accountId: string,
  area: string,
): Promise<AreaAgentResult> {
  try {
    const { data: members, error } = await db
      .from('profiles')
      .select('user_id')
      .eq('account_id', accountId)
      .ilike('area', area)
    if (error || !members || members.length === 0) return { agentId: null }

    const ids = (members as Array<{ user_id: string }>).map((m) => m.user_id)

    const { data: presenceRows } = await db
      .from('member_presence')
      .select('user_id, status, last_seen_at')
      .eq('account_id', accountId)
      .in('user_id', ids)

    const now = Date.now()
    const online: string[] = []
    const away: string[] = []
    for (const p of (presenceRows ?? []) as Array<{
      user_id: string
      status: string
      last_seen_at: string
    }>) {
      const state = derivePresence(p.status as StoredPresence, p.last_seen_at, now)
      if (state === 'online') online.push(p.user_id)
      else if (state === 'away') away.push(p.user_id)
    }

    const pool = online.length > 0 ? online : away
    if (pool.length === 0) return { agentId: null }

    const { data: openConvs } = await db
      .from('conversations')
      .select('assigned_agent_id')
      .in('assigned_agent_id', pool)
      .neq('status', 'closed')
      .limit(5000)

    const load = new Map<string, number>(pool.map((id) => [id, 0]))
    for (const c of (openConvs ?? []) as Array<{ assigned_agent_id: string | null }>) {
      const id = c.assigned_agent_id
      if (id && load.has(id)) load.set(id, (load.get(id) ?? 0) + 1)
    }

    let best = pool[0]
    for (const id of pool) {
      if ((load.get(id) ?? 0) < (load.get(best) ?? 0)) best = id
    }
    return { agentId: best }
  } catch (err) {
    console.error('[ai auto-reply] findConnectedAgentForArea failed:', err)
    return { agentId: null }
  }
}

/** Atomic service-only transfer, including the shared fidelity audience. */
export async function routeConversationToArea(db: Db, accountId: string, conversationId: string, area: string): Promise<AreaAgentResult> {
  const { data, error } = await db.rpc('route_conversation_area', { p_account: accountId, p_conversation: conversationId, p_area: area });
  if (error) throw error;
  return { agentId: data?.agent_id ?? null };
}

export function explicitlyRequestedArea(text: string): 'ventas' | 'fidelizacion' | null {
  const value = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (!/hablar|pasame|pasen|comunicar|contactar|deriva|area|asesor/.test(value)) return null;
  if (/academi|fideliza/.test(value)) return 'fidelizacion';
  if (/\bventas\b/.test(value)) return 'ventas';
  return null;
}
