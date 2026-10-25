import { describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/automations/meta-send', () => ({ engineSendText: vi.fn() }))
vi.mock('./handoff-routing', () => ({ routeConversationToArea: vi.fn(), explicitlyRequestedArea: () => null }))
import { explicitlyWantsHuman, handleExplicitHumanRequest } from './explicit-human-request'
import { engineSendText } from '@/lib/automations/meta-send'
import { routeConversationToArea } from './handoff-routing'
import type { SupabaseClient } from '@supabase/supabase-js'

describe('solicitud humana sin tokens de IA', () => {
  it.each(['Quiero hablar con una asesora', 'Necesito una persona real', 'Pásame con alguien',
    'Parece robot', 'Eres un bot', '¿Puedo comunicarme con un humano?', 'Asesora real por favor'])('reconoce %s', text => {
    expect(explicitlyWantsHuman(text)).toBe(true)
  })
  it.each(['Quiero información de Recursos Humanos', 'Soy estudiante de recursos humanos',
    '¿Cuánto cuesta el curso?', 'No necesito una asesora', 'No quiero un asesor'])('no deriva por %s', text => {
    expect(explicitlyWantsHuman(text)).toBe(false)
  })
  it.each(['commercial_human', 'payment_followup_help'])('deriva el botón %s', replyId => {
    expect(explicitlyWantsHuman('', replyId)).toBe(true)
  })
})

describe('pausa y derivación reales con dependencias simuladas', () => {
  const args = { accountId: 'account', conversationId: 'chat', contactId: 'contact', userId: 'author', text: 'Quiero hablar con una asesora real' }
  function database() {
    const conversation: Record<string, unknown> = { id: 'chat', ai_enabled: true, automation_enabled: true, ai_handed_off_at: null }
    const writes: Array<{ table: string; payload: Record<string, unknown>; filters: unknown[] }> = []
    const from = (table: string) => {
      let payload: Record<string, unknown> | undefined
      const filters: unknown[] = []
      const resolve = () => {
        if (payload) {
          writes.push({ table, payload, filters })
          if (table === 'conversations') Object.assign(conversation, payload)
          return { data: table === 'conversations' ? { id: 'chat' } : null, error: null }
        }
        return { data: table === 'conversations' ? { ...conversation } : table === 'tags' ? { id: 'urgent-tag' } : null, error: null }
      }
      const builder = {
        select: () => builder, update: (value: Record<string, unknown>) => { payload = value; return builder },
        upsert: (value: Record<string, unknown>) => { payload = value; return builder },
        eq: (key: string, value: unknown) => { filters.push([key, value]); return builder },
        is: (key: string, value: unknown) => { filters.push([key, value]); return builder },
        contains: () => builder, limit: () => builder,
        maybeSingle: async () => resolve(),
        then: (callback: (value: unknown) => unknown) => Promise.resolve(resolve()).then(callback),
      }
      return builder
    }
    return { db: { from } as unknown as SupabaseClient, writes, conversation }
  }
  it('pausa ambas, conserva la posición y notifica una sola vez', async () => {
    vi.mocked(engineSendText).mockReset().mockResolvedValue({ whatsapp_message_id: 'mock' })
    vi.mocked(routeConversationToArea).mockReset().mockResolvedValue({ agentId: null })
    const { db, writes, conversation } = database()
    expect(await handleExplicitHumanRequest(db, args)).toBe(true)
    expect(conversation).toMatchObject({ ai_enabled: false, automation_enabled: false })
    expect(writes).toContainEqual(expect.objectContaining({ table: 'automation_pending_executions', payload: { status: 'paused' } }))
    expect(writes[0].filters).toContainEqual(['account_id', 'account'])
    expect(writes[0].payload).not.toHaveProperty('assigned_agent_id')
    expect(await handleExplicitHumanRequest(db, args)).toBe(true)
    expect(engineSendText).toHaveBeenCalledTimes(1)
    expect(routeConversationToArea).toHaveBeenCalledTimes(1)
  })
  it('un fallo de envío no reactiva ni repite el mensaje', async () => {
    vi.mocked(engineSendText).mockReset().mockRejectedValue(Error('simulated free-send guard'))
    vi.mocked(routeConversationToArea).mockReset().mockResolvedValue({ agentId: null })
    const { db, conversation } = database()
    expect(await handleExplicitHumanRequest(db, args)).toBe(true)
    expect(await handleExplicitHumanRequest(db, args)).toBe(true)
    expect(conversation).toMatchObject({ ai_enabled: false, automation_enabled: false })
    expect(engineSendText).toHaveBeenCalledTimes(1)
  })
  it('respeta una pausa manual y deja el caso sin aviso automático', async () => {
    vi.mocked(engineSendText).mockReset()
    vi.mocked(routeConversationToArea).mockReset().mockResolvedValue({ agentId: null })
    const { db, conversation } = database()
    Object.assign(conversation, { ai_enabled: false, automation_enabled: false })
    expect(await handleExplicitHumanRequest(db, args)).toBe(true)
    expect(engineSendText).not.toHaveBeenCalled()
  })
})
