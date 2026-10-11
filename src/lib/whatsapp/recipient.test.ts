import { describe, expect, it } from 'vitest'
import { resolveWhatsAppRecipient } from './recipient'
describe('WhatsApp recipient resolution', () => {
  it('preserves phone delivery when a valid phone exists', () => {
    expect(resolveWhatsAppRecipient({phone:'+51 933 691 668',whatsapp_user_id:'PE.123'})).toMatchObject({address:'51933691668',isPhone:true})
  })
  it('uses the opaque user ID without phone variants when no phone is visible', () => {
    expect(resolveWhatsAppRecipient({phone:'',whatsapp_user_id:'PE.2348747195891805'})).toEqual({address:'PE.2348747195891805',variants:['PE.2348747195891805'],isPhone:false})
  })
  it('falls back to ID if a stored phone is invalid', () => {
    expect(resolveWhatsAppRecipient({phone:'unknown',whatsapp_user_id:'PE.123'}).isPhone).toBe(false)
  })
  it.each(['', '123', 'PE.123/other', 'PE.123?x', 'PE.123\nextra'])('rejects invalid ID %s', value => {
    expect(()=>resolveWhatsAppRecipient({whatsapp_user_id:value})).toThrow()
  })
})
