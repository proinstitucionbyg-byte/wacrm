import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ send: vi.fn(), media: vi.fn(), context: vi.fn() }))
vi.mock('@/lib/automations/meta-send', () => ({ engineSendInteractive: h.send, engineSendMedia: h.media }))
vi.mock('./context', () => ({ buildConversationContext: h.context }))
import { runSalesWindowFollowups, salesClosingWindowOpen, type SalesClosingCandidate } from './sales-window-followup'
import type { SupabaseClient } from '@supabase/supabase-js'

const payload = { kind: 'buttons' as const, body: 'Inscríbete hoy por S/19.90',
  buttons: [{ id: 'activate', title: 'Activa mi promo' }, { id: 'query', title: 'Otras consultas' }] }
const candidate = (): SalesClosingCandidate => ({ account_id: 'account', conversation_id: 'chat',
  user_id: 'author', contact_id: 'contact', inbound_id: 'inbound', inbound_at: '2026-10-18T07:30:00Z',
  inbound_text: 'Quiero información de Nutrición', automation_id: 'course', automation_name: 'NUTRICION 19.90 (49.90)',
  step_id: 'last-stable-id', payload })
function database(row = candidate()) {
  let claimed = false
  const updates: unknown[] = []
  const steps = [
    { id: 'image', step_type: 'send_media', step_config: { media_type: 'image', media_url: 'https://example.com/image.png', caption: 'Último contacto' }, position: 0 },
    { id: 'audio', step_type: 'send_media', step_config: { media_type: 'audio', media_url: 'https://example.com/audio.ogg', audio_transcript: 'Promoción de 49.90' }, position: 1 },
    { id: 'button', step_type: 'send_buttons', step_config: { kind: 'buttons', body: 'Comienza ahora', buttons: [{ id: 'btn_1', title: '🔥 Activar mi promo' }] }, position: 2 },
  ]
  const chain = (value: unknown) => ({ eq: () => chain(value), is: () => chain(value), order: async () => ({ data: value, error: null }),
    contains: () => chain(value), limit: async () => ({ data: value, error: null }) })
  const db = { rpc: vi.fn(async (name: string) => {
    if (name === 'sales_window_followup_candidates') return { data: [row], error: null }
    if (claimed) return { data: [], error: null }
    claimed = true
    return { data: [{ id: 'reservation', payload: row.payload, inbound_at: row.inbound_at }], error: null }
  }), from: vi.fn((table: string) => table === 'automations'
    ? { select: () => chain([{ id: 'closing-flow', user_id: 'author' }]) }
    : table === 'automation_steps'
      ? { select: () => chain(steps) }
      : ({ update: (data: unknown) => {
    updates.push(data); return { eq: async () => ({ error: null }) }
  } })) }
  return { db: db as unknown as SupabaseClient, raw: db, updates }
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-19T06:30:00Z'))
  h.context.mockResolvedValue([{ role: 'user', content: 'Quiero información de Nutrición' }])
  h.media.mockResolvedValueOnce({ whatsapp_message_id: 'wamid.image' })
    .mockResolvedValueOnce({ whatsapp_message_id: 'wamid.audio' })
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
  it('sends image, audio, then configured button once without starting an automation', async () => {
    const { db, updates } = database()
    expect(await runSalesWindowFollowups(db)).toBe(1)
    expect(await runSalesWindowFollowups(db)).toBe(0)
    expect(h.send).toHaveBeenCalledTimes(1)
    expect(h.media).toHaveBeenCalledTimes(2)
    expect(h.media.mock.invocationCallOrder[0]).toBeLessThan(h.media.mock.invocationCallOrder[1])
    expect(h.media.mock.invocationCallOrder[1]).toBeLessThan(h.send.mock.invocationCallOrder[0])
    expect(h.send).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ body: 'Comienza ahora' }), accountId: 'account', conversationId: 'chat' }))
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
    h.media.mockReset().mockResolvedValueOnce({ whatsapp_message_id: 'wamid.image' }).mockRejectedValueOnce(Error('timeout'))
    const { db, updates } = database()
    expect(await runSalesWindowFollowups(db)).toBe(0)
    expect(await runSalesWindowFollowups(db)).toBe(0)
    expect(h.send).not.toHaveBeenCalled()
    expect(h.media).toHaveBeenCalledTimes(2)
    expect(updates).toContainEqual({ status: 'review', error: 'timeout' })
  })
  it('does not use S/49.90 media for a S/79.90 course', async () => {
    const row = { ...candidate(), automation_name: 'NUTRICION 19.90' }
    expect(await runSalesWindowFollowups(database(row).db)).toBe(0)
    expect(h.media).not.toHaveBeenCalled()
  })
})
