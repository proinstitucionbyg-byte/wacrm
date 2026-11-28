import {beforeEach,it,expect,vi} from 'vitest';
import {routeOrganicManualReply} from './manual-continuation';
import type {SupabaseClient} from '@supabase/supabase-js';
const actor='11111111-1111-4111-8111-111111111111';
let referral:unknown=null,primaryReady=true,backupReady=true;
const rpc=vi.fn();
function db(){return {rpc,from:(table:string)=>{const data=()=>table==='conversations'?{id:actor,first_ad_referral:referral}:table==='messages'?{id:actor,whatsapp_session_line_key:null,source_referral:null}:table==='whatsapp_support_routes'?{enabled:true,line_order:['WA-backup','WA-main']}:[{line_key:'WA-backup',linked_phone:'51924413651',paused:false,support_ready_at:backupReady?new Date().toISOString():null},{line_key:'WA-main',linked_phone:'51933691668',paused:false,support_ready_at:primaryReady?new Date().toISOString():null}];const q={select:()=>q,eq:()=>q,not:()=>q,order:()=>q,limit:()=>q,maybeSingle:async()=>({data:data(),error:null}),then:(ok:(v:unknown)=>unknown)=>Promise.resolve({data:data(),error:null}).then(ok)};return q;}} as unknown as SupabaseClient;}
const args={accountId:actor,conversationId:actor,senderId:actor,messageType:'text',text:'Hola'};
beforeEach(()=>{referral=null;primaryReady=true;backupReady=true;rpc.mockReset().mockResolvedValue({data:{message_row_id:'row',message_id:'waweb-job:job'},error:null});});
it('prefers 933 and queues before any Meta transport or quota reservation',async()=>{expect(await routeOrganicManualReply(db(),args)).toEqual({messageId:'row',whatsappMessageId:'waweb-job:job'});expect(rpc).toHaveBeenCalledWith('continue_whatsapp_conversation',expect.objectContaining({p_line:'WA-main',p_phone:'51933691668'}));});
it('selects the next ready authorized line when 933 is offline',async()=>{primaryReady=false;await routeOrganicManualReply(db(),args);expect(rpc).toHaveBeenCalledWith('continue_whatsapp_conversation',expect.objectContaining({p_line:'WA-backup'}));});
it('refuses an organic send rather than falling back to Cloud with no lines',async()=>{primaryReady=backupReady=false;await expect(routeOrganicManualReply(db(),args)).rejects.toThrow('No se enviará por Meta');expect(rpc).not.toHaveBeenCalled();});
it('preserves confirmed ad-origin handling',async()=>{referral={ctwa_clid:'confirmed'};expect(await routeOrganicManualReply(db(),args)).toBeNull();expect(rpc).not.toHaveBeenCalled();});
it('does not reinterpret a queue error as permission to use Meta',async()=>{rpc.mockResolvedValue({data:null,error:{code:'42501'}});await expect(routeOrganicManualReply(db(),args)).rejects.toThrow('No se enviará por Meta');expect(rpc).toHaveBeenCalledTimes(1);});
