import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
const transport = vi.hoisted(() => vi.fn())
vi.mock('./meta-api', async importOriginal => ({ ...await importOriginal<typeof import('./meta-api')>(), sendSocialPart: transport }))
import { sendSocialMessage, type SocialSendInput } from './send'

const input: SocialSendInput = { accountId: 'account', conversationId: 'conv', contactId: 'contact', channel: 'instagram', externalId: '456', messageType: 'text', text: 'Hola\n\nBienvenida' }
function database(results: unknown[]) {
  const writes: unknown[] = [], filters: unknown[] = []
  const from = vi.fn((table: string) => {
    const result = results.shift() ?? { error: null }
    const chain = {
      select: () => chain,
      eq: (...args: unknown[]) => { filters.push([table, ...args]); return chain },
      insert: (value: unknown) => { writes.push([table, value]); return chain },
      update: (value: unknown) => { writes.push([table, value]); return chain },
      maybeSingle: async () => result, single: async () => result,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
    }
    return chain
  })
  return { db: { from } as unknown as SupabaseClient, writes, filters }
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('META_CHANNEL_ACCOUNT_ID', 'account')
  vi.stubEnv('INSTAGRAM_BUSINESS_ACCOUNT_ID', '123')
  vi.stubEnv('INSTAGRAM_ACCESS_TOKEN', 'test-token')
  transport.mockResolvedValue('meta-confirmation')
})
afterEach(() => vi.unstubAllEnvs())
describe('shared social send', () => {
  it('rejects a conversation outside the selected account before sending', async () => {
    const { db, filters } = database([{ data: null }])
    await expect(sendSocialMessage(db, input)).rejects.toThrow('conversación')
    expect(transport).not.toHaveBeenCalled()
    expect(filters).toContainEqual(['conversations', 'account_id', 'account'])
    expect(filters).toContainEqual(['conversations', 'contact_id', 'contact'])
  })
  it('stores only a confirmed send, retaining the agent and text', async () => {
    const { db, writes } = database([{ data: { id: 'conv' } }, { data: { id: 'internal' } }, { error: null }])
    expect(await sendSocialMessage(db, { ...input, senderId: 'agent' })).toEqual({ whatsapp_message_id: 'meta-confirmation', message_id: 'internal' })
    expect(writes[0]).toEqual(['messages', expect.objectContaining({ sender_type: 'agent', sender_id: 'agent', message_id: 'meta-confirmation', content_text: input.text })])
  })
  it('does not save a fake success if Meta rejects the request', async () => {
    transport.mockRejectedValue(new Error('Meta no autoriza'))
    const { db, writes } = database([{ data: { id: 'conv' } }])
    await expect(sendSocialMessage(db, input)).rejects.toThrow('Meta')
    expect(writes).toEqual([])
  })
  it('warns about a confirmed send whose database insert failed', async () => {
    const { db } = database([{ data: { id: 'conv' } }, { error: { message: 'denied' } }])
    await expect(sendSocialMessage(db, input)).rejects.toThrow('Meta recibió')
  })
  it('retains a delivered image if its following caption fails', async () => {
    transport.mockResolvedValueOnce('image-confirmation').mockRejectedValueOnce(new Error('Meta denied caption'))
    const { db, writes } = database([{ data: { id: 'conv' } }, { data: { id: 'image' } }, { error: null }])
    await expect(sendSocialMessage(db, { ...input, messageType: 'image', mediaUrl: 'https://example.org/a.jpg' })).rejects.toThrow('Meta denied caption')
    expect(writes.filter(write => (write as unknown[])[0] === 'messages')).toHaveLength(1)
  })
})
