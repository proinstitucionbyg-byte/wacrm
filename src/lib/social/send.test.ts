import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
const transport = vi.hoisted(() => vi.fn())
const convertAudio = vi.hoisted(() => vi.fn())
const pauseAdmin = vi.hoisted(() => vi.fn())
vi.mock('./instagram-audio', () => ({ instagramAudioUrl: convertAudio }))
vi.mock('@/lib/flows/admin-client', () => ({ supabaseAdmin: pauseAdmin }))
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
  convertAudio.mockResolvedValue('https://example.org/converted.m4a')
  pauseAdmin.mockReturnValue(database([{ error: null }]).db)
})
afterEach(() => vi.unstubAllEnvs())
describe('shared social send', () => {
  it('sends converted Instagram audio but keeps the original recording in the CRM', async () => {
    const { db, writes } = database([{ data: { id: 'conv' } }, { data: { id: 'internal' } }, { error: null }])
    await sendSocialMessage(db, { ...input, messageType: 'audio', text: null, mediaUrl: 'https://example.org/original.ogg' })
    expect(convertAudio).toHaveBeenCalledWith('account', 'https://example.org/original.ogg')
    expect(transport.mock.calls[0][3].message.attachment.payload.url).toBe('https://example.org/converted.m4a')
    expect(writes[0]).toEqual(['messages', expect.objectContaining({ content_type: 'audio', media_url: 'https://example.org/original.ogg' })])
  })
  it('does not prepare private media for an inaccessible conversation', async () => {
    const { db } = database([{ data: null }])
    await expect(sendSocialMessage(db, { ...input, messageType: 'audio', mediaUrl: 'https://example.org/original.ogg' })).rejects.toThrow('conversación')
    expect(convertAudio).not.toHaveBeenCalled()
  })
  it('rejects a conversation outside the selected account before sending', async () => {
    const { db, filters } = database([{ data: null }])
    await expect(sendSocialMessage(db, input)).rejects.toThrow('conversación')
    expect(transport).not.toHaveBeenCalled()
    expect(filters).toContainEqual(['conversations', 'account_id', 'account'])
    expect(filters).toContainEqual(['conversations', 'contact_id', 'contact'])
  })
  it('stores only a confirmed send, retaining the agent and text', async () => {
    const { db, writes } = database([{ data: { id: 'conv' } }, { data: { id: 'internal' } }, { error: null }])
    const pause = database([{ error: null }])
    pauseAdmin.mockReturnValue(pause.db)
    expect(await sendSocialMessage(db, { ...input, senderId: 'agent' })).toEqual({ whatsapp_message_id: 'meta-confirmation', message_id: 'internal' })
    expect(writes[0]).toEqual(['messages', expect.objectContaining({ sender_type: 'agent', sender_id: 'agent', message_id: 'meta-confirmation', content_text: input.text })])
    expect(writes[1]).toEqual(['conversations', expect.objectContaining({ last_message_at: expect.any(String) })])
    expect(pauseAdmin).toHaveBeenCalledOnce()
    expect(pause.filters).toContainEqual(['flow_runs', 'account_id', 'account'])
    expect(pause.filters).toContainEqual(['flow_runs', 'contact_id', 'contact'])
  })
  it('does not pause a Flow for an automated social send', async () => {
    const { db, writes } = database([{ data: { id: 'conv' } }, { data: { id: 'internal' } }, { error: null }])
    await sendSocialMessage(db, input)
    expect(writes[1]).toEqual(['conversations', expect.not.objectContaining({ last_message_at: expect.anything() })])
    expect(pauseAdmin).not.toHaveBeenCalled()
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
    await expect(sendSocialMessage(db, { ...input, senderId: 'agent', messageType: 'image', mediaUrl: 'https://example.org/a.jpg' })).rejects.toThrow('Meta denied caption')
    expect(writes.filter(write => (write as unknown[])[0] === 'messages')).toHaveLength(1)
    expect(pauseAdmin).toHaveBeenCalledOnce()
  })
})
