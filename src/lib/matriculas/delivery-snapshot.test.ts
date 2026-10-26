import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { readEnrollmentDeliverySnapshots } from './delivery-snapshot';

function fixture(deliveries: unknown[], messages: unknown[], fail?: string) {
  const reads: Array<{table:string;filters:unknown[]}> = [];
  const db = {from:(table:string)=>{
    const read={table,filters:[] as unknown[]};reads.push(read);
    const chain={select:()=>chain,eq:(...args:unknown[])=>{read.filters.push(args);return chain;},
      in:(...args:unknown[])=>{read.filters.push(args);return chain;},
      then:(resolve:(v:unknown)=>unknown)=>Promise.resolve({data:table==='messages'?messages:deliveries,error:fail===table?Error('read failed'):null}).then(resolve)};
    return chain;
  }} as unknown as SupabaseClient;
  return {db,reads};
}
const enrollment={id:'enrollment',conversation_id:'chat'};
const sent={enrollment_id:'enrollment',kind:'BOLETA',status:'sent',whatsapp_message_id:'wamid'};
describe('enrollment delivery evidence for central sheets',()=>{
  it('does not query without eligible enrollments',async()=>{
    const f=fixture([],[]);expect((await readEnrollmentDeliverySnapshots(f.db,'account',[])).size).toBe(0);expect(f.reads).toEqual([]);
  });
  it('requires actual delivery in the matching conversation and scopes every read',async()=>{
    const f=fixture([sent],[{conversation_id:'other-chat',message_id:'wamid',status:'read',billing_delivered_at:'2026-10-26T17:00:00Z'}]);
    const result=await readEnrollmentDeliverySnapshots(f.db,'account',[enrollment]);
    expect(result.get('enrollment')?.[0]).toEqual({kind:'BOLETA',status:'sent',message_status:null,delivered_at:null});
    expect(f.reads[0].filters).toEqual([['account_id','account'],['enrollment_id',['enrollment']]]);
    expect(f.reads[1].filters).toEqual([['conversation_id',['chat']],['message_id',['wamid']]]);
  });
  it.each(['delivered','read'])('exports confirmed %s evidence without message contents or credentials',async status=>{
    const f=fixture([sent],[{conversation_id:'chat',message_id:'wamid',status,billing_delivered_at:'2026-10-26T17:00:00Z'}]);
    expect((await readEnrollmentDeliverySnapshots(f.db,'account',[enrollment])).get('enrollment')).toEqual([
      {kind:'BOLETA',status:'sent',message_status:status,delivered_at:'2026-10-26T17:00:00Z'}]);
  });
  it('never turns an uncertain send or mere sent status into delivered',async()=>{
    for(const status of ['review','sending','sent']){
      const f=fixture([{...sent,status}],[{conversation_id:'chat',message_id:'wamid',status:'sent',billing_delivered_at:null}]);
      const row=(await readEnrollmentDeliverySnapshots(f.db,'account',[enrollment])).get('enrollment')?.[0];
      expect(row?.delivered_at).toBeNull();expect(row?.message_status).toBe(status==='sent'?'sent':null);
    }
  });
  it.each(['messages','enrollment_document_deliveries'])('fails closed when %s cannot be read',async table=>{
    const f=fixture([sent],[],table);await expect(readEnrollmentDeliverySnapshots(f.db,'account',[enrollment])).rejects.toThrow('read failed');
  });
});
