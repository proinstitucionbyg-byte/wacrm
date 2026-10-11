import { describe, expect, it } from 'vitest'
import { parseSocialInbound } from './inbound'

const event = (mid = 'm1') => ({ sender: { id: '456' }, recipient: { id: '123' }, timestamp: 1791691200000, message: { mid, text: 'Información de nutrición' } })
const body = (events: unknown[] = [event()], id = '123', object = 'instagram') => ({ object, entry: [{ id, messaging: events }] })
describe('social webhook parser', () => {
  it('preserves referral evidence from the event without manufacturing a campaign name', () => {
    const raw = {...event(), referral:{ad_id:'998',source:'ADS',campaign_name:'not supplied by the supported field'}};
    expect(parseSocialInbound('messenger',body([raw],'123','page'),'123')[0].referral).toEqual({ad_id:'998',source:'ADS'});
  })
  it('keeps every message in a batch', () => {
    expect(parseSocialInbound('instagram', body([event(), event('m2')]), '123').map(e => e.messageId)).toEqual(['m1', 'm2'])
  })
  it('rejects another asset, channel and recipient', () => {
    expect(parseSocialInbound('instagram', body(undefined, '789'), '123')).toEqual([])
    expect(parseSocialInbound('messenger', body(), '123')).toEqual([])
    expect(parseSocialInbound('instagram', body([{ ...event(), recipient: { id: '789' } }]), '123')).toEqual([])
  })
  it('ignores echo/delivery/read events and messages without an ID', () => {
    expect(parseSocialInbound('instagram', body([{ ...event(), message: { ...event().message, is_echo: true } }, { delivery: {} }, { ...event(), message: { text: 'hola' } }]), '123')).toEqual([])
  })
  it('preserves attachment types and a single caption for multiple photos', () => {
    const raw = { ...event(), message: { ...event().message, text: 'Mi DNI', attachments: [{ type: 'image', payload: { url: 'https://cdn.example.org/front.jpg' } }, { type: 'image', payload: { url: 'https://cdn.example.org/back.jpg' } }] } }
    const [parsed] = parseSocialInbound('instagram', body([raw]), '123')
    expect(parsed.parts.map(p => [p.type, p.text])).toEqual([['image', 'Mi DNI'], ['image', null]])
  })
  it('maps a file to document and rejects insecure attachment links', () => {
    const raw = { ...event(), message: { mid: 'm', attachments: [{ type: 'file', payload: { url: 'https://cdn.example.org/doc.pdf' } }, { type: 'image', payload: { url: 'http://localhost/x' } }] } }
    expect(parseSocialInbound('instagram', body([raw]), '123')[0].parts.map(p => p.type)).toEqual(['document'])
  })
  it('keeps the payload of a quick reply for flow continuation', () => {
    const raw = { ...event(), message: { ...event().message, quick_reply: { payload: 'activar-promo' } } }
    expect(parseSocialInbound('instagram', body([raw]), '123')[0].replyId).toBe('activar-promo')
  })
  it('handles Messenger postbacks without reinterpreting the ID as a phone', () => {
    const raw = { ...event(), message: undefined, postback: { mid: 'p1', title: 'Malla', payload: 'malla-id' } }
    expect(parseSocialInbound('messenger', body([raw], '123', 'page'), '123')[0]).toMatchObject({ senderId: '456', replyId: 'malla-id', parts: [{ type: 'interactive' }] })
  })
})
