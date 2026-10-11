import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ after: vi.fn(), admin: vi.fn(), store: vi.fn(), dispatch: vi.fn() }))
vi.mock('next/server', () => ({ after: mocks.after, NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } }))
vi.mock('@/lib/automations/admin-client', () => ({ supabaseAdmin: mocks.admin }))
vi.mock('./process-inbound', () => ({ storeSocialInbound: mocks.store, dispatchSocialInbound: mocks.dispatch }))
import { receiveSocialWebhook, verifySocialSubscription } from './webhook'

const payload = { object: 'instagram', entry: [{ id: '123', messaging: [{ sender: { id: '456' }, recipient: { id: '123' }, timestamp: 1, message: { mid: 'mid-test', text: 'Hola' } }] }] }
function request(body: unknown, signed = true) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body)
  return new Request('https://example.org/api/instagram/webhook', { method: 'POST', body: raw, headers: signed ? { 'x-hub-signature-256': 'sha256=' + createHmac('sha256', 'secret').update(raw).digest('hex') } : {} })
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('META_APP_SECRET', 'secret')
  vi.stubEnv('MESSENGER_VERIFY_TOKEN', 'verify-test')
  vi.stubEnv('META_CHANNEL_ACCOUNT_ID', 'account')
  vi.stubEnv('INSTAGRAM_BUSINESS_ACCOUNT_ID', '123')
  vi.stubEnv('INSTAGRAM_ACCESS_TOKEN', 'test-token')
})
afterEach(() => vi.unstubAllEnvs())
describe('social webhook boundary', () => {
  it('rejects missing or wrong signatures before querying data', async () => {
    expect((await receiveSocialWebhook(request(payload, false), 'instagram')).status).toBe(401)
    expect(mocks.admin).not.toHaveBeenCalled()
  })
  it('rejects signed malformed JSON', async () => {
    expect((await receiveSocialWebhook(request('{'), 'instagram')).status).toBe(400)
  })
  it('acknowledges another asset without storing it', async () => {
    const other = { ...payload, entry: [{ ...payload.entry[0], id: '999' }] }
    expect((await receiveSocialWebhook(request(other), 'instagram')).status).toBe(200)
    expect(mocks.admin).not.toHaveBeenCalled()
    expect(mocks.after).not.toHaveBeenCalled()
  })
  it('dispatches only after confirming the bound account', async () => {
    const filters: unknown[] = []
    const chain = { select: () => chain, eq: (...args: unknown[]) => { filters.push(args); return chain }, maybeSingle: async () => ({ data: { id: 'account', owner_user_id: 'owner' }, error: null }) }
    const db = { from: vi.fn(() => chain) }
    mocks.admin.mockReturnValue(db)
    mocks.store.mockResolvedValue({ conversationId: 'conv' })
    expect((await receiveSocialWebhook(request(payload), 'instagram')).status).toBe(200)
    expect(filters).toContainEqual(['id', 'account'])
    expect(mocks.store).not.toHaveBeenCalled()
    await mocks.after.mock.calls[0][0]()
    expect(mocks.store).toHaveBeenCalledWith(db, 'instagram', { id: 'account', owner_user_id: 'owner' }, expect.objectContaining({ senderId: '456' }))
    expect(mocks.dispatch).toHaveBeenCalledWith(db, { conversationId: 'conv' })
  })
  it('checks the configured subscription challenge and fails closed without a token', async () => {
    const url = 'https://example.org/hook?hub.mode=subscribe&hub.verify_token=verify-test&hub.challenge=123'
    expect(await verifySocialSubscription(new Request(url)).text()).toBe('123')
    vi.stubEnv('MESSENGER_VERIFY_TOKEN', '')
    expect(verifySocialSubscription(new Request(url)).status).toBe(403)
  })
})
