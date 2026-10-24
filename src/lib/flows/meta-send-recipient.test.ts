import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  send: vi.fn(), insert: vi.fn(), update: vi.fn(), rpc: vi.fn(),
  contact: { id: 'contact', phone: '', whatsapp_user_id: 'PE.2348747195891805', channel: 'whatsapp' },
}))
vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendTextMessage: mocks.send, sendMediaMessage: mocks.send,
  sendInteractiveButtons: mocks.send, sendInteractiveList: mocks.send,
}))
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: () => 'test-token' }))
vi.mock('@/lib/social/send', () => ({ sendSocialMessage: vi.fn() }))
vi.mock('./admin-client', () => ({ supabaseAdmin: () => ({
  from: (table: string) => {
    const query = {
      select: () => query, eq: () => query, in: () => query, limit: () => query,
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve({ data: null, count: 0, error: null }).then(resolve, reject),
      maybeSingle: async () => ({ data: table === 'conversations'
        ? {
            id: 'conversation', contact_id: 'contact', user_id: 'user',
            ai_enabled: true, automation_enabled: true,
            last_customer_message_at: new Date(Date.now() - 60_000).toISOString(),
            first_ad_referral: null,
            first_ad_referral_at: null,
          }
        : table === 'whatsapp_config'
          ? { phone_number_id: 'number' }
          : mocks.contact, error: null }),
      single: async () => ({ data: { access_token: 'encrypted', phone_number_id: 'number' }, error: null }),
      insert: mocks.insert,
      update: (value: unknown) => { mocks.update(table, value); return query },
    }
    return query
  },
  rpc: mocks.rpc,
}) }))
import { engineSendText, engineSendMedia, engineSendInteractiveButtons, engineSendInteractiveList } from './meta-send'

describe('engine sends to WhatsApp contacts with a hidden phone', () => {
  const base = { accountId: 'account', userId: 'user', conversationId: 'conversation', contactId: 'contact' }
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.send.mockResolvedValue({ messageId: 'wamid.test' })
    mocks.insert.mockResolvedValue({ error: null })
    mocks.rpc.mockResolvedValue({ data: [{ reservation_id: 'quota-reservation', free_tier_available: true, used: 1, remaining: 999 }], error: null })
  })
  it.each(['text', 'image', 'audio', 'buttons', 'list'] as const)('sends %s to the unchanged ID and records success', async kind => {
    if (kind === 'text') await engineSendText({ ...base, text: 'Hola' })
    else if (kind === 'image' || kind === 'audio') await engineSendMedia({ ...base, kind, link: 'https://example.com/media' })
    else if (kind === 'buttons') await engineSendInteractiveButtons({ ...base, bodyText: 'Opciones', buttons: [{ id: 'a', title: 'A' }] })
    else await engineSendInteractiveList({ ...base, bodyText: 'Opciones', buttonLabel: 'Ver', sections: [{ title: 'Cursos', rows: [{ id: 'a', title: 'A' }] }] })
    expect(mocks.send).toHaveBeenCalledTimes(1)
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ to: 'PE.2348747195891805' }))
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ message_id: 'wamid.test', status: 'sent' }))
    expect(mocks.rpc).toHaveBeenCalledWith('reserve_whatsapp_service_message', expect.objectContaining({ p_account_id: 'account', p_phone_number_id: 'number', p_allow_over_quota: false }))
    expect(mocks.update).toHaveBeenCalledWith('whatsapp_service_message_reservations', expect.objectContaining({ status: 'sent', message_id: 'wamid.test' }))
    expect(mocks.update).not.toHaveBeenCalledWith('contacts', expect.anything())
    const conversationWrites = mocks.update.mock.calls.filter(([table]) => table === 'conversations')
    expect(conversationWrites.length).toBeGreaterThan(0)
    for (const [, value] of conversationWrites)
      expect(value).not.toEqual(expect.objectContaining({ last_message_at: expect.anything() }))
  })
})
