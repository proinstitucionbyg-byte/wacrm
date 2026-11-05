import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
const h=vi.hoisted(()=>({context:vi.fn()}))
vi.mock('./context',()=>({buildConversationContext:h.context}))
import {runSalesWindowFollowups,salesClosingWindowOpen} from './sales-window-followup'
import type {SupabaseClient} from '@supabase/supabase-js'
function fixture(text='Quiero información de Nutrición'){
 let claimed=false
 const rpc=vi.fn(async(name:string)=>name==='sales_window_followup_candidates'?{data:[{conversation_id:'chat',account_id:'account',inbound_id:'in',inbound_at:'2026-11-04T12:00:00Z',inbound_text:text,step_id:'first'}],error:null}:claimed?{data:[],error:null}:(claimed=true,{data:[{id:'reservation'}],error:null}))
 return{rpc,db:{rpc} as unknown as SupabaseClient}
}
 beforeEach(()=>{vi.spyOn(Date,'now').mockReturnValue(Date.parse('2026-11-05T11:30:00Z'));h.context.mockResolvedValue([])})
 afterEach(()=>vi.restoreAllMocks())
 describe('closing 30 minutes before the customer window ends',()=>{
 it('starts at 23h30 and never sends at or after 24h',()=>{
 const start=Date.parse('2026-11-04T12:00:00Z')
 expect(salesClosingWindowOpen(new Date(start).toISOString(),start+23.5*3600000-1)).toBe(false)
 expect(salesClosingWindowOpen(new Date(start).toISOString(),start+23.5*3600000)).toBe(true)
 expect(salesClosingWindowOpen(new Date(start).toISOString(),start+24*3600000)).toBe(false)
 expect(salesClosingWindowOpen('invalid')).toBe(false)
 })
 it('claims the existing configured sequence once; no media is sent inline',async()=>{
 const f=fixture();expect(await runSalesWindowFollowups(f.db)).toBe(1);expect(await runSalesWindowFollowups(f.db)).toBe(0)
 expect(f.rpc).toHaveBeenCalledWith('claim_sales_window_followup',{p_conversation:'chat',p_inbound:'in',p_step:'first'})
 })
 it.each(['No me interesa','Ya pagué','Soy un chatbot','Soy estudiante, no puedo ingresar a mi clase'])('does not claim for %s',async(text)=>{
 const f=fixture(text);expect(await runSalesWindowFollowups(f.db)).toBe(0);expect(f.rpc).toHaveBeenCalledTimes(1)
 })
 })
