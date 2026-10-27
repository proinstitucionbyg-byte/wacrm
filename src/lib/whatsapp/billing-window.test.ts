import {describe,it,expect,vi,afterEach} from 'vitest'
import {assertAutomaticWhatsAppSendIsFree} from './billing-runtime'
function fixture(last:string) {
  const rpc=vi.fn()
  const db={rpc,from:(table:string)=>{
    const result={data:table==='conversations'?{last_customer_message_at:last,
      first_ad_referral:{source_type:'ad',source_id:'verified-ad'},first_ad_referral_at:'2026-10-26T17:00:00Z'}:
      table==='whatsapp_config'?{phone_number_id:'business'}:null,error:null,count:1000}
    const q:any={select:()=>q,eq:()=>q,in:()=>q,maybeSingle:()=>Promise.resolve(result),then:(fn:any)=>Promise.resolve(result).then(fn)}
    return q
  }} as any
  return {db,rpc}
}
afterEach(()=>vi.useRealTimers())
describe('independent WhatsApp service-window boundary',()=>{
  it('blocks free-form messages with 72h ad coverage but expired 24h service permission',async()=>{
    vi.useFakeTimers();vi.setSystemTime('2026-10-27T18:00:00Z')
    const {db,rpc}=fixture('2026-10-26T17:00:00Z')
    await expect(assertAutomaticWhatsAppSendIsFree(db,{accountId:'a',conversationId:'chat'})).rejects.toThrow('24 horas')
    expect(rpc).not.toHaveBeenCalled()
  })
  it('allows the covered first response while service permission remains open',async()=>{
    vi.useFakeTimers();vi.setSystemTime('2026-10-27T18:00:00Z')
    const {db,rpc}=fixture('2026-10-27T17:00:00Z')
    expect((await assertAutomaticWhatsAppSendIsFree(db,{accountId:'a',conversationId:'chat'})).reservationId).toBeNull()
    expect(rpc).not.toHaveBeenCalled()
  })
  it('leaves approved templates to their separate economic and provider checks',async()=>{
    vi.useFakeTimers();vi.setSystemTime('2026-10-27T18:00:00Z')
    const {db}=fixture('2026-10-26T17:00:00Z')
    expect((await assertAutomaticWhatsAppSendIsFree(db,{accountId:'a',conversationId:'chat',messageCategory:'template'})).preflight.free_entry_window_open).toBe(true)
  })
})
