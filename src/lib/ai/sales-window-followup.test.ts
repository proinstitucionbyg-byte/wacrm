import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ send: vi.fn(), context: vi.fn() }))
vi.mock('@/lib/automations/meta-send', () => ({ engineSendInteractive: h.send }))
vi.mock('./context', () => ({ buildConversationContext: h.context }))
import { runSalesWindowFollowups, salesClosingWindowOpen, type SalesClosingCandidate } from './sales-window-followup'
import type { SupabaseClient } from '@supabase/supabase-js'

const payload = { kind: 'buttons' as const, body: 'Inscríbete hoy por S/19.90',
  buttons: [{ id: 'activate', title: 'Activa mi promo' }, { id: 'query', title: 'Otras consultas' }] }
const candidate = (): SalesClosingCandidate => ({ account_id: 'account', conversation_id: 'chat',
  user_id: 'author', contact_id: 'contact', inbound_id: 'inbound', inbound_at: '2026-10-18T07:30:00Z',
  inbound_text: 'Quiero información de Nutrición', automation_id: 'course', automation_name: 'NUTRICION 19.90',
  step_id: 'last-stable-id', payload })
function database(row = candidate()) {
  let claimed = false
  const updates: unknown[] = []
  const db = { rpc: vi.fn(async (name: string) => {
    if (name === 'sales_window_followup_candidates') return { data: [row], error: null }
    if (claimed) return { data: [], error: null }
    claimed = true
    return { data: [{ id: 'reservation', payload: row.payload, inbound_at: row.inbound_at }], error: null }
  }), from: vi.fn(() => ({ update: (data: unknown) => {
    updates.push(data); return { eq: async () => ({ error: null }) }
  } })) }
  return { db: db as unknown as SupabaseClient, raw: db, updates }
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-19T06:30:00Z'))
  h.context.mockResolvedValue([{ role: 'user', content: 'Quiero información de Nutrición' }])
  h.send.mockResolvedValue({ whatsapp_message_id: 'wamid.closing' })
})
afterEach(() => vi.restoreAllMocks())
describe('sales closing at 23 hours', () => {
  it('opens exactly at 23 hours and closes at 24, regardless of outgoing times', () => {
    const start = Date.parse('2026-10-18T07:30:00Z')
    expect(salesClosingWindowOpen(new Date(start).toISOString(), start + 23 * 3_600_000 - 1)).toBe(false)
    expect(salesClosingWindowOpen(new Date(start).toISOString(), start + 23 * 3_600_000)).toBe(true)
    expect(salesClosingWindowOpen(new Date(start).toISOString(), start + 24 * 3_600_000)).toBe(false)
    expect(salesClosingWindowOpen('invalid')).toBe(false)
  })
  it('sends the exact saved final buttons once without starting an automation', async () => {
    const { db, updates } = database()
    expect(await runSalesWindowFollowups(db)).toBe(1)
    expect(await runSalesWindowFollowups(db)).toBe(0)
    expect(h.send).toHaveBeenCalledTimes(1)
    expect(h.send).toHaveBeenCalledWith(expect.objectContaining({ payload, accountId: 'account', conversationId: 'chat' }))
    expect(updates).toContainEqual(expect.objectContaining({ status: 'sent', message_id: 'wamid.closing' }))
  })
  it.each(['No me interesa', 'Ya pagué', 'Soy un chatbot'])('does not send for %s', async (text) => {
    const row = { ...candidate(), inbound_text: text }
    const { db } = database(row)
    expect(await runSalesWindowFollowups(db)).toBe(0)
    expect(h.send).not.toHaveBeenCalled()
  })
  it('does not send the old course when the last choice changed', async () => {
    h.context.mockResolvedValue([{ role: 'user', content: 'Ahora quiero Farmacia' }])
    expect(await runSalesWindowFollowups(database().db)).toBe(0)
  })
  it('does not sell to someone asking for support with existing classes', async () => {
    const row = { ...candidate(), inbound_text: 'Soy estudiante, no puedo ingresar a mi clase' }
    h.context.mockResolvedValue([{ role: 'user', content: row.inbound_text }])
    expect(await runSalesWindowFollowups(database(row).db)).toBe(0)
  })
  it('retains an uncertain send for review instead of retrying it', async () => {
    h.send.mockRejectedValue(Error('timeout'))
    const { db, updates } = database()
    expect(await runSalesWindowFollowups(db)).toBe(0)
    expect(await runSalesWindowFollowups(db)).toBe(0)
    expect(h.send).toHaveBeenCalledTimes(1)
    expect(updates).toContainEqual({ status: 'review', error: 'timeout' })
  })
  it('does not send an invalid edited final block', async () => {
    const row = { ...candidate(), payload: { ...payload, buttons: [] } }
    expect(await runSalesWindowFollowups(database(row).db)).toBe(0)
    expect(h.send).not.toHaveBeenCalled()
  })
})
