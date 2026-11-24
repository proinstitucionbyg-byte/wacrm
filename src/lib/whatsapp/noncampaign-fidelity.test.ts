import { beforeEach, describe, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ wait: vi.fn(), route: vi.fn() }))
vi.mock('./cloud-support-wait', () => ({ enqueueSupportWait: h.wait }))
vi.mock('@/lib/ai/handoff-routing', () => ({ routeConversationToArea: h.route }))
import { pauseNoncampaignFidelity } from './noncampaign-fidelity'
const args = { accountId: 'a', conversationId: 'c', contactId: 'p', messageId: 'm', hasConfirmedAdOrigin: false, channel: 'session' as const }
function database(referral: unknown = null) {
  const q: Record<string, ReturnType<typeof vi.fn>> = {}
  for (const method of ['select', 'eq', 'is', 'update', 'in', 'not', 'limit']) q[method] = vi.fn(() => q)
  q.maybeSingle = vi.fn(async () => ({ data: null, error: null }))
  q.single = vi.fn(async () => ({ data: { first_ad_referral: referral, whatsapp_support_line_key: null }, error: null }))
  q.then = vi.fn((resolve) => Promise.resolve({ error: null }).then(resolve))
  const from = vi.fn(() => q)
  return { db: { from } as never, from, q }
}
beforeEach(() => vi.clearAllMocks())
describe('temporary organic fidelity policy', () => {
  it('allows replies after an accepted commercial campaign', async () => {
    const {db,q}=database()
    q.maybeSingle.mockResolvedValue({data:{id:'sent'},error:null})
    expect(await pauseNoncampaignFidelity(db,args)).toBe(false)
    expect(q.update).not.toHaveBeenCalled()
  })
  it('preserves historical campaign customers, including after a sale', async () => {
    const { db, q } = database({ source_type: 'ad', source_id: '123' })
    expect(await pauseNoncampaignFidelity(db, args)).toBe(false)
    expect(q.update).not.toHaveBeenCalled()
    expect(h.route).not.toHaveBeenCalled()
  })
  it('preserves a newly confirmed campaign without querying or pausing', async () => {
    const { db, from } = database()
    expect(await pauseNoncampaignFidelity(db, { ...args, hasConfirmedAdOrigin: true })).toBe(false)
    expect(from).not.toHaveBeenCalled()
  })
  it('pauses organic sessions and routes to fidelity without sending', async () => {
    const { db, q } = database()
    expect(await pauseNoncampaignFidelity(db, args)).toBe(true)
    expect(q.update).toHaveBeenCalledWith(expect.objectContaining({ ai_enabled: false, automation_enabled: false }))
    expect(h.route).toHaveBeenCalledWith(db, 'a', 'c', 'fidelizacion')
  })
  it('waits for late Meta evidence before classifying Cloud', async () => {
    const { db, q } = database()
    expect(await pauseNoncampaignFidelity(db, { ...args, channel: 'cloud' })).toBe(true)
    expect(h.wait).toHaveBeenCalledOnce()
    expect(q.update).not.toHaveBeenCalled()
  })
  it('pauses Cloud after the three-minute classification wait', async () => {
    const { db } = database()
    expect(await pauseNoncampaignFidelity(db, { ...args, channel: 'cloud', metaWaitExpired: true })).toBe(true)
    expect(h.route).toHaveBeenCalledOnce()
    expect(h.wait).not.toHaveBeenCalled()
  })
})
