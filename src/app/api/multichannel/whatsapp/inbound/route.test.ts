import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ rpc: vi.fn(), dispatch: vi.fn(), db: undefined as unknown }))
vi.mock('@/lib/automations/admin-client', () => ({ supabaseAdmin: () => h.db }))
vi.mock('@/lib/whatsapp/inbound-dispatch', () => ({ dispatchInboundThroughCrm: h.dispatch }))

import { POST } from './route'

const token = `wcm_${'a'.repeat(64)}`
const event = {
  line_key: 'WA-SOPORTE', linked_phone: '51911111111', provider_message_id: 'provider-1',
  chat_id: '51922222222@c.us', occurred_at: '2026-10-29T10:00:00.000Z', type: 'chat', text: 'Quiero informes',
}

function mockDb(rpcResult = 'recorded') {
  const rows: Record<string, { data: unknown; error: null }> = {
    multichannel_workers: { data: { id: 'worker', account_id: 'account' }, error: null },
    whatsapp_session_inbound_receipts: { data: { message_row_id: 'message-row', contact_created: true, is_first_inbound: true, previous_inbound_at: null }, error: null },
    messages: { data: { message_id: 'waweb:WA-SOPORTE:provider-1', conversation_id: 'conversation', content_text: 'Quiero informes', created_at: event.occurred_at }, error: null },
    conversations: { data: { id: 'conversation', contact_id: 'contact', user_id: 'owner', automation_enabled: true, ai_enabled: true, last_human_message_at: null }, error: null },
  }
  const from = vi.fn((table: string) => {
    const builder = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue(rows[table]),
    }
    return builder
  })
  const db = { from, rpc: vi.fn().mockResolvedValue({ data: rpcResult, error: null }) }
  h.db = db
  return db
}

function request(body: unknown, bearer = token) {
  return new Request('https://crm.example/api/multichannel/whatsapp/inbound', {
    method: 'POST', headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.db = undefined
  process.env.MULTICHANNEL_WHATSAPP_SESSION_BRIDGE_ENABLED = 'true'
  h.dispatch.mockResolvedValue(undefined)
})

describe('WhatsApp session inbound route', () => {
  it.each(['recorded', 'duplicate'])('sends a %s plain-text event to the shared CRM dispatcher', async result => {
    const db = mockDb(result)
    const response = await POST(request(event))
    expect(response.status).toBe(200)
    expect(h.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'session', accountId: 'account', userId: 'owner', contactId: 'contact',
      conversationId: 'conversation', messageId: 'waweb:WA-SOPORTE:provider-1',
      isFirstInboundMessage: true, contactCreated: true, hasConfirmedAdOrigin: false,
    }))
    expect(db.rpc).toHaveBeenCalledOnce()
  })

  it('persists non-text events without starting text automations', async () => {
    mockDb()
    const response = await POST(request({ ...event, type: 'image', text: 'caption' }))
    expect(response.status).toBe(200)
    expect(h.dispatch).not.toHaveBeenCalled()
  })

  it('does not start the bridge when its server flag is off', async () => {
    delete process.env.MULTICHANNEL_WHATSAPP_SESSION_BRIDGE_ENABLED
    const response = await POST(request(event))
    expect(response.status).toBe(503)
    expect(h.db).toBeUndefined()
  })
})
