import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
const mocks = vi.hoisted(() => ({ download: vi.fn(), save: vi.fn(), analyze: vi.fn(), transcribe: vi.fn(), usage: vi.fn(), collect: vi.fn(), sequence: vi.fn(), flows: vi.fn(), automations: vi.fn(), ai: vi.fn(), sales: vi.fn(), followup: vi.fn() }))
vi.mock('./storage', () => ({ saveSocialImage: mocks.save }))
vi.mock('./media', () => ({ downloadSocialMedia: mocks.download }))
vi.mock('@/lib/ai/analyze-image', () => ({ analyzeInboundImage: mocks.analyze }))
vi.mock('@/lib/ai/transcribe', () => ({ transcribeSavedAudio: mocks.transcribe }))
vi.mock('@/lib/ai/usage', () => ({ logAiUsage: mocks.usage }))
vi.mock('@/lib/matriculas/collect', () => ({ collectConversationEnrollments: mocks.collect }))
vi.mock('@/lib/matriculas/sequence', () => ({ startEnrollmentSequence: mocks.sequence }))
vi.mock('@/lib/flows/engine', () => ({ dispatchInboundToFlows: mocks.flows }))
vi.mock('@/lib/automations/engine', () => ({ runAutomationsForTrigger: mocks.automations }))
vi.mock('@/lib/ai/auto-reply', () => ({ dispatchInboundToAiReply: mocks.ai }))
vi.mock('@/lib/ai/sales-routing', () => ({ routeInboundSales: mocks.sales }))
vi.mock('@/lib/ai/followup', () => ({ handleIdleFollowupReply: mocks.followup }))
import { storeSocialInbound, dispatchSocialInbound, type SocialDispatchContext } from './process-inbound'
import type { SocialInbound } from './inbound'

function database(results: unknown[]) {
  const writes: { table: string; kind: string; value: unknown }[] = [], filters: unknown[][] = []
  const from = vi.fn((table: string) => {
    const result = results.shift() ?? { data: null, error: null }
    const chain = {
      select: () => chain,
      eq: (...args: unknown[]) => { filters.push([table, ...args]); return chain },
      is: () => chain,
      insert: (value: unknown) => { writes.push({ table, kind: 'insert', value }); return chain },
      update: (value: unknown) => { writes.push({ table, kind: 'update', value }); return chain },
      maybeSingle: async () => result, single: async () => result,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
    }
    return chain
  })
  return { db: { from } as unknown as SupabaseClient, from, writes, filters }
}
const ok = (data: unknown = null) => ({ data, error: null })
const incoming: SocialInbound = { assetId: '123', senderId: '456', messageId: 'mid1', text: 'Hola', replyId: null, replyTo: null, createdAt: '2026-10-10T23:00:00Z', parts: [{ type: 'text', text: 'Hola', url: null }] }
const account = { id: 'acct', owner_user_id: 'owner' }
const dispatch: SocialDispatchContext = { accountId: 'acct', userId: 'owner', contactId: 'contact', conversationId: 'conv', messageId: 'mid1', text: 'Información de nutrición', replyId: null, isFirstInboundMessage: false, wasCreated: false, hasImageEvidence: false }
beforeEach(() => {
  vi.resetAllMocks()
  mocks.flows.mockResolvedValue({ consumed: false })
  mocks.automations.mockResolvedValue(false)
  mocks.followup.mockResolvedValue(false)
  mocks.download.mockResolvedValue({ buffer: Buffer.from('image'), contentType: 'image/jpeg' })
  mocks.analyze.mockResolvedValue({ analysis: { status: 'pending_review', category: 'payment_receipt' }, usage: null })
})
afterEach(() => vi.unstubAllEnvs())
describe('social intake', () => {
  it('stores a social message and collects enrollment data', async () => {
    const { db, writes, filters } = database([ok({ id: 'contact', phone: '' }), ok({ id: 'conv' }), ok(), { count: 0 }, ok({ id: 'msg' }), ok()])
    const context = await storeSocialInbound(db, 'instagram', account, incoming)
    expect(context).toMatchObject({ contactId: 'contact', conversationId: 'conv', isFirstInboundMessage: true })
    expect(writes).toContainEqual(expect.objectContaining({ table: 'messages', value: expect.objectContaining({ sender_type: 'customer', message_id: 'mid1', content_text: 'Hola' }) }))
    expect(filters).toContainEqual(['contacts', 'account_id', 'acct'])
    expect(mocks.collect).toHaveBeenCalledWith(db, 'acct', 'conv')
  })
  it('ignores a previously stored webhook retry', async () => {
    const { db, writes } = database([ok({ id: 'contact', phone: '' }), ok({ id: 'conv' }), ok({ id: 'already' })])
    expect(await storeSocialInbound(db, 'instagram', account, incoming)).toBeNull()
    expect(writes).toEqual([])
    expect(mocks.collect).not.toHaveBeenCalled()
  })
  it('does not manufacture a phone from the social ID', async () => {
    const { db, writes } = database([ok(), ok({ id: 'contact', phone: '' }), ok({ id: 'conv' }), ok(), { count: 0 }, ok({ id: 'msg' }), ok()])
    await storeSocialInbound(db, 'messenger', account, incoming)
    expect(writes[0]).toMatchObject({ table: 'contacts', value: { channel: 'messenger', external_id: '456', phone: '' } })
  })
  it('reads a voucher and starts only the unvalidated receipt continuation', async () => {
    const { db, writes } = database([ok({ id: 'contact', phone: '' }), ok({ id: 'conv' }), ok(), { count: 2 }, ok({ id: 'msg' }), ok({ id: 'review' }), ok(), ok()])
    await storeSocialInbound(db, 'instagram', account, { ...incoming, parts: [{ type: 'image', url: 'https://cdn.example.org/voucher.jpg', text: null }] })
    expect(mocks.analyze).toHaveBeenCalledWith(expect.objectContaining({ accountId: 'acct', media: expect.objectContaining({ contentType: 'image/jpeg' }) }))
    expect(mocks.sequence).toHaveBeenCalledWith(db, 'acct', 'review', 'receipt')
    expect(writes.some(w => JSON.stringify(w.value).includes('validated'))).toBe(false)
    expect(writes).toContainEqual({ table: 'payment_reviews', kind: 'update', value: { origin: 'INSTAGRAM' } })
  })
  it('keeps unreadable images in the chat for human review', async () => {
    mocks.download.mockRejectedValue(new Error('download failed'))
    const { db, writes } = database([ok({ id: 'contact', phone: '' }), ok({ id: 'conv' }), ok(), { count: 1 }, ok({ id: 'msg' }), ok()])
    await storeSocialInbound(db, 'instagram', account, { ...incoming, parts: [{ type: 'image', url: 'https://cdn.example.org/photo.jpg', text: null }] })
    expect(writes).toContainEqual(expect.objectContaining({ table: 'messages', value: expect.objectContaining({ image_analysis: { status: 'failed', failure_reason: 'provider_error' } }) }))
    expect(mocks.sequence).not.toHaveBeenCalled()
  })
})
describe('social funnel dispatch', () => {
  it('keeps automation and AI active after the sales assignment', async () => {
    mocks.sales.mockResolvedValue(true)
    const { db } = database([ok({ id: 'conv', ai_enabled: true, automation_enabled: true }), ok()])
    await dispatchSocialInbound(db, dispatch)
    expect(mocks.sales).toHaveBeenCalled()
    expect(mocks.flows).toHaveBeenCalled()
    expect(mocks.automations).toHaveBeenCalledTimes(2)
    expect(mocks.ai).toHaveBeenCalled()
  })
  it('suppresses automatic replies during the human five minute window', async () => {
    const { db } = database([ok({ id: 'conv', last_human_message_at: new Date().toISOString() })])
    await dispatchSocialInbound(db, dispatch)
    expect(mocks.sales).not.toHaveBeenCalled()
    expect(mocks.flows).not.toHaveBeenCalled()
    expect(mocks.automations).not.toHaveBeenCalled()
    expect(mocks.ai).not.toHaveBeenCalled()
  })
  it('lets a saved block answer before AI', async () => {
    mocks.automations.mockResolvedValue(true)
    const { db } = database([ok({ id: 'conv' })])
    await dispatchSocialInbound(db, dispatch)
    expect(mocks.ai).not.toHaveBeenCalled()
  })
  it('does not run competing keyword blocks when a flow consumed the reply', async () => {
    mocks.flows.mockResolvedValue({ consumed: true })
    const { db } = database([ok({ id: 'conv' })])
    await dispatchSocialInbound(db, dispatch)
    expect(mocks.automations).not.toHaveBeenCalled()
    expect(mocks.ai).not.toHaveBeenCalled()
  })
  it('cancels ordinary waits without cancelling the welcome deadline', async () => {
    const { db, filters, writes } = database([ok({ id: 'conv' }), ok()])
    await dispatchSocialInbound(db, dispatch)
    expect(writes).toContainEqual({ table: 'automation_pending_executions', kind: 'update', value: { status: 'cancelled' } })
    expect(filters).toContainEqual(['automation_pending_executions', 'account_id', 'acct'])
  })
  it('never dispatches an inaccessible conversation', async () => {
    const { db } = database([ok()])
    await expect(dispatchSocialInbound(db, dispatch)).rejects.toThrow('Conversación')
    expect(mocks.ai).not.toHaveBeenCalled()
  })
})
