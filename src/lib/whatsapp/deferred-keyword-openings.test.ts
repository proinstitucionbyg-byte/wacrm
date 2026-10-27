import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest'
import type {SupabaseClient} from '@supabase/supabase-js'
const h=vi.hoisted(()=>({run:vi.fn(),flow:vi.fn(),gate:vi.fn(),tables:{} as Record<string,any[]>,writes:[] as any[],error:''}))
vi.mock('@/lib/automations/engine',()=>({runAutomationsForTrigger:h.run}))
vi.mock('@/lib/flows/engine',()=>({dispatchInboundToFlows:h.flow}))
vi.mock('./billing-runtime',()=>({gateAutomaticWhatsAppConversation:h.gate}))
import {enqueueDeferredKeywordOpening,resumeDeferredKeywordOpening,KEYWORD_OPENING_META_WAIT_MS} from './deferred-keyword-openings'
const row={id:'queue',account_id:'account',user_id:'owner',contact_id:'contact',conversation_id:'chat',meta_message_id:'wamid.original',
  message_text:'Quiero Nutrición',received_at:'2026-10-27T10:00:00Z',contact_created:true}
const db={from:(table:string)=>{
  let mutation=false
  const resolve=()=>({data:mutation?null:h.tables[table]??[],error:h.error===table?{message:'read failed'}:null})
  const q:any={select:()=>q,eq:()=>q,is:()=>q,in:()=>q,limit:()=>q,
    update:(v:unknown)=>{mutation=true;h.writes.push({table,value:v});return q},
    upsert:(v:unknown)=>{mutation=true;h.writes.push({table,value:v});return q},
    maybeSingle:async()=>{const r=resolve();return {...r,data:r.data?.[0]??null}},
    then:(fn:any)=>Promise.resolve(resolve()).then(fn)}
  return q
}} as unknown as SupabaseClient
const result=()=>h.writes.at(-1)?.value
beforeEach(()=>{
  vi.useFakeTimers();vi.setSystemTime('2026-10-27T10:10:00Z');vi.clearAllMocks();h.error='';h.writes=[]
  h.tables={conversations:[{automation_enabled:true,last_customer_message_at:row.received_at,
    first_ad_referral:{source_type:'ad',source_id:'real-ad'}}],messages:[{id:'inbound'}],
    automations:[{trigger_config:{keywords:['Quiero Nutrición'],match_type:'exact'}}],flows:[],payment_reviews:[],automation_pending_executions:[]}
  h.run.mockResolvedValue(true);h.flow.mockResolvedValue({consumed:false});h.gate.mockResolvedValue({allowed:false})
})
afterEach(()=>vi.useRealTimers())
describe('delayed Meta origin recheck',()=>{
  it('schedules the original opening for ten minutes without sending',async()=>{
    expect(KEYWORD_OPENING_META_WAIT_MS).toBe(600000)
    await enqueueDeferredKeywordOpening(db,row)
    expect(result()).toMatchObject({run_at:'2026-10-27T10:20:00.000Z',status:'pending',meta_message_id:'wamid.original'})
    expect(h.run).not.toHaveBeenCalled()
  })
  it('launches the matched opening after confirmed referral, keeping its inbound identity',async()=>{
    await resumeDeferredKeywordOpening(db,row)
    expect(result()).toMatchObject({status:'done',result:'automation_started',billing_resolution:'confirmed'})
    expect(h.run).toHaveBeenCalledWith(expect.objectContaining({context:expect.objectContaining({inbound_message_id:'wamid.original'})}))
  })
  it('keeps unconfirmed origin out of automatic paid sends',async()=>{
    h.tables.conversations[0].first_ad_referral=null
    await resumeDeferredKeywordOpening(db,row)
    expect(result()).toMatchObject({result:'ad_origin_unconfirmed_after_10m',billing_resolution:'por_confirmar'})
    expect(h.run).not.toHaveBeenCalled();expect(h.flow).not.toHaveBeenCalled()
  })
  it('accepts delayed advertising evidence saved on the original inbound message',async()=>{
    h.tables.conversations[0].first_ad_referral=null
    h.tables.messages[0].source_referral={source_type:'ad',source_id:'ad-arrived-later'}
    await resumeDeferredKeywordOpening(db,row)
    expect(result()).toMatchObject({result:'automation_started',billing_resolution:'confirmed'})
    expect(h.writes).toContainEqual({table:'conversations',value:{
      first_ad_referral:{source_type:'ad',source_id:'ad-arrived-later'},first_ad_referral_at:row.received_at,
    }})
  })
  it('preserves an existing conflicting first referral rather than replacing it',async()=>{
    h.tables.conversations[0].first_ad_referral={source_type:'other'}
    h.tables.messages[0].source_referral={source_type:'ad',source_id:'new-ad'}
    await resumeDeferredKeywordOpening(db,row)
    expect(result().result).toBe('conflicting_ad_origin_evidence');expect(h.run).not.toHaveBeenCalled()
  })
  it.each(['payment_reviews','automation_pending_executions'])('preserves %s that appeared during the wait',async table=>{
    h.tables[table]=[{id:'existing'}];await resumeDeferredKeywordOpening(db,row)
    expect(result().status).toBe('cancelled');expect(h.run).not.toHaveBeenCalled()
  })
  it('never reactivates a manual pause',async()=>{
    h.tables.conversations[0].automation_enabled=false;await resumeDeferredKeywordOpening(db,row)
    expect(result().result).toBe('automation_manually_disabled');expect(h.run).not.toHaveBeenCalled()
  })
  it('does not send outside the service window or over a human reply',async()=>{
    h.tables.conversations[0].last_customer_message_at='2026-10-26T10:00:00Z'
    await resumeDeferredKeywordOpening(db,row);expect(result().result).toBe('service_window_expired')
    h.tables.conversations[0].last_human_message_at='2026-10-27T10:05:00Z'
    await resumeDeferredKeywordOpening(db,row);expect(result().result).toBe('adviser_replied_while_waiting')
    expect(h.run).not.toHaveBeenCalled()
  })
  it('fails closed if eligibility cannot be checked',async()=>{
    h.error='payment_reviews';await resumeDeferredKeywordOpening(db,row)
    expect(result().result).toBe('recheck_eligibility_failed');expect(h.run).not.toHaveBeenCalled()
  })
  it('rereads the active keyword rather than inventing a match',async()=>{
    h.tables.automations=[];await resumeDeferredKeywordOpening(db,row)
    expect(result().result).toBe('opening_keyword_no_longer_active');expect(h.run).not.toHaveBeenCalled()
  })
})
