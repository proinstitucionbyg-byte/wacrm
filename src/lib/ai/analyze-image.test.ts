import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { analyzeInboundImage } from './analyze-image'
import { loadAiConfig } from './config'
import { getMediaUrl, downloadMedia } from '@/lib/whatsapp/meta-api'

vi.mock('./config', () => ({ loadAiConfig: vi.fn() }))
vi.mock('@/lib/whatsapp/meta-api', () => ({ getMediaUrl: vi.fn(), downloadMedia: vi.fn() }))
const args = { db: {} as SupabaseClient, accountId: 'test', mediaId: 'image-test', accessToken: 'test-token' }
const fetchMock = vi.fn()
function response(recipient: string | null, category = 'payment_receipt') {
  return { ok: true, json: async () => ({ output: [{ content: [{ type: 'output_text', text: JSON.stringify({ category, fields: { recipient, amount: '19.90', transaction_reference: 'TEST-001' }, observations: [] }) }] }], usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 } }) }
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  vi.mocked(loadAiConfig).mockResolvedValue({ isActive: true, provider: 'openai', model: 'test-model', apiKey: 'test-key' } as Awaited<ReturnType<typeof loadAiConfig>>)
  vi.mocked(getMediaUrl).mockResolvedValue({ url: 'https://example.test/media', mimeType: 'image/jpeg' } as Awaited<ReturnType<typeof getMediaUrl>>)
  vi.mocked(downloadMedia).mockResolvedValue({ buffer: Buffer.from('test-image'), contentType: 'image/jpeg' })
  fetchMock.mockResolvedValue(response('LUIS BRAYAN PALACIOS CARHUAPOMA'))
})
afterEach(() => vi.unstubAllGlobals())
describe('lectura de comprobantes', () => {
  it('extracts visible fields and matches the corrected full recipient without approving payment', async () => {
    const result = await analyzeInboundImage(args)
    expect(result.analysis.status).toBe('pending_review')
    expect(result.analysis.fields?.amount).toBe('19.90')
    expect(result.analysis.recipient_check).toEqual({ expected: 'LUIS BRAYAN PALACIOS CARHUAPOMA', status: 'exact_match' })
    expect(result.usage?.totalTokens).toBe(150)
  })
  it.each(['LUIS PALACIOS', 'LUIS B. PALACIOS C.', 'LUIS BRYAN PALACIOS CARBA POMA', 'OTRA PERSONA'])('requires review for abbreviated or different recipient %s', async (name) => {
    fetchMock.mockResolvedValue(response(name))
    expect((await analyzeInboundImage(args)).analysis.recipient_check?.status).toBe('review_required')
  })
  it('ignores case and extra spaces in the full name', async () => {
    fetchMock.mockResolvedValue(response('  Luis   Brayan Palacios Carhuapoma '))
    expect((await analyzeInboundImage(args)).analysis.recipient_check?.status).toBe('exact_match')
  })
  it('does not invent an unreadable recipient', async () => {
    fetchMock.mockResolvedValue(response(null))
    expect((await analyzeInboundImage(args)).analysis.recipient_check?.status).toBe('missing')
  })
  it('does not compare identity document names against the payment recipient', async () => {
    fetchMock.mockResolvedValue(response(null, 'identity_document'))
    expect((await analyzeInboundImage(args)).analysis.recipient_check).toBeUndefined()
  })
  it('avoids downloading when AI is not configured', async () => {
    vi.mocked(loadAiConfig).mockResolvedValue(null)
    expect((await analyzeInboundImage(args)).analysis.failure_reason).toBe('not_configured')
    expect(getMediaUrl).not.toHaveBeenCalled()
  })
  it('rejects unsupported files before sending them to AI', async () => {
    vi.mocked(downloadMedia).mockResolvedValue({ buffer: Buffer.from('test'), contentType: 'application/pdf' })
    expect((await analyzeInboundImage(args)).analysis.failure_reason).toBe('unsupported_format')
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('rejects images above the size limit', async () => {
    vi.mocked(downloadMedia).mockResolvedValue({ buffer: Buffer.alloc(10 * 1024 * 1024 + 1), contentType: 'image/jpeg' })
    expect((await analyzeInboundImage(args)).analysis.failure_reason).toBe('too_large')
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('returns an explicit failure for provider errors', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchMock.mockResolvedValue({ ok: false, status: 503 })
    expect((await analyzeInboundImage(args)).analysis.failure_reason).toBe('provider_error')
    vi.restoreAllMocks()
  })
  it('retains usage for a malformed model response', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ output: [{ content: [{ type: 'output_text', text: 'not JSON' }] }], usage: { input_tokens: 100, output_tokens: 50 } }) })
    const result = await analyzeInboundImage(args)
    expect(result.analysis.failure_reason).toBe('unreadable')
    expect(result.usage?.totalTokens).toBe(150)
  })
  it('uses the configured Anthropic provider and extracts the same evidence', async () => {
    vi.mocked(loadAiConfig).mockResolvedValue({ isActive: true, provider: 'anthropic', model: 'test-model', apiKey: 'test-key' } as Awaited<ReturnType<typeof loadAiConfig>>)
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ content: [{ type: 'text', text: JSON.stringify({ category: 'payment_receipt', fields: { recipient: 'LUIS BRAYAN PALACIOS CARHUAPOMA' } }) }], usage: { input_tokens: 100, output_tokens: 50 } }) })
    const result = await analyzeInboundImage(args)
    expect(result.provider).toBe('anthropic')
    expect(result.analysis.recipient_check?.status).toBe('exact_match')
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.anthropic.com/v1/messages')
    expect(result.usage?.totalTokens).toBe(150)
  })
})
