import { afterEach, describe, expect, it, vi } from 'vitest'
import { socialConfiguration, socialMessageParts, sendSocialPart } from './meta-api'

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })
describe('social Meta transport', () => {
  it('requires the exact account binding', () => {
    vi.stubEnv('META_CHANNEL_ACCOUNT_ID', 'owner')
    expect(() => socialConfiguration('instagram', 'other')).toThrow('META_CHANNEL_ACCOUNT_ID')
  })
  it('requires the asset and token for the chosen channel', () => {
    vi.stubEnv('META_CHANNEL_ACCOUNT_ID', 'owner')
    vi.stubEnv('INSTAGRAM_BUSINESS_ACCOUNT_ID', '123')
    vi.stubEnv('INSTAGRAM_ACCESS_TOKEN', 'secret-test')
    expect(socialConfiguration('instagram', 'owner')).toEqual({ assetId: '123', token: 'secret-test' })
  })
  it.each(['instagram', 'messenger'] as const)('preserves the original text and captions on %s', channel => {
    const text = 'Nombre\n\nDNI\nCorreo'
    expect(socialMessageParts(channel, { messageType: 'text', text })[0].contentText).toBe(text)
    const parts = socialMessageParts(channel, { messageType: 'image', mediaUrl: 'https://example.org/image.jpg', text })
    expect(parts.map(p => p.contentType)).toEqual(['image', 'text'])
    expect(parts[1].contentText).toBe(text)
  })
  it('maps Messenger documents to a real file attachment', () => {
    expect(socialMessageParts('messenger', { messageType: 'document', mediaUrl: 'https://example.org/boleta.pdf' })[0].message).toMatchObject({ attachment: { type: 'file' } })
  })
  it('sends an Instagram PDF as a download link without pretending it was attached', () => {
    const [part] = socialMessageParts('instagram', { messageType: 'document', filename: 'BOLETA.pdf', mediaUrl: 'https://example.org/boleta.pdf' })
    expect(part.contentType).toBe('text')
    expect(part.contentText).toBe('BOLETA.pdf\nhttps://example.org/boleta.pdf')
  })
  it('retains reply IDs for the existing flow', () => {
    const [part] = socialMessageParts('instagram', { messageType: 'interactive', interactivePayload: { kind: 'buttons', body: 'Continúa', buttons: [{ id: 'promo-1990', title: 'Activar promo' }] } })
    expect(part.message).toMatchObject({ quick_replies: [{ payload: 'promo-1990', title: 'Activar promo' }] })
  })
  it('preserves full WhatsApp list titles and descriptions', () => {
    const [part] = socialMessageParts('messenger', { messageType: 'interactive', interactivePayload: {
      kind: 'list', body: 'Elige tu curso', button_label: 'Ver cursos', sections: [{ title: 'Cursos', rows: [{ id: 'nutrition', title: 'Nutrición y dietética', description: 'Martes y jueves de 8 a 10 p.m.' }] }],
    } })
    expect(part.contentText).toContain('Nutrición y dietética: Martes y jueves de 8 a 10 p.m.')
    expect(part.message).toMatchObject({ quick_replies: [{ payload: 'nutrition' }] })
  })
  it.each(['http://example.org/x', '/api/whatsapp/media/1', '123456', 'https://u:p@example.org/x'])('rejects inaccessible media %s', mediaUrl => {
    expect(() => socialMessageParts('instagram', { messageType: 'image', mediaUrl })).toThrow('HTTPS')
  })
  it('does not invent a social equivalent of a WhatsApp template', () => {
    expect(() => socialMessageParts('instagram', { messageType: 'template' })).toThrow('no está disponible')
  })
  it('uses a bearer header and requires a real confirmation', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ message_id: 'mid' }) })
    vi.stubGlobal('fetch', fetchMock)
    const part = socialMessageParts('messenger', { messageType: 'text', text: 'prueba' })[0]
    expect(await sendSocialPart('messenger', { assetId: '123', token: 'test-secret' }, '456', part)).toBe('mid')
    expect(fetchMock.mock.calls[0][0]).not.toContain('test-secret')
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer test-secret')
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) })
    await expect(sendSocialPart('messenger', { assetId: '123', token: 'test-secret' }, '456', part)).rejects.toThrow('confirmación')
  })
  it.each([3, 10, 200, 190])('reports a failed permission/token result (%i)', async code => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: { code } }) }))
    const part = socialMessageParts('instagram', { messageType: 'text', text: 'prueba' })[0]
    await expect(sendSocialPart('instagram', { assetId: '123', token: 'test-secret' }, '456', part)).rejects.toThrow(/Meta/)
  })
})
