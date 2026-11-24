import {expect,it} from 'vitest';import{smsBatchPreview}from'./sms-batch';
const ids=Array.from({length:5},(_,i)=>`11111111-1111-4111-8111-${String(i).padStart(12,'0')}`);
const plan={action:'enqueue_batch',request_id:ids[0],line_key:'SMS-one',purpose:'notice',body:'Hola 👋',contact_ids:ids,run_at:'2030-01-01T10:00:00Z',expires_at:'2030-01-01T11:00:00Z',interval_seconds:10,block_size:2,block_pause_seconds:30};
it('spaces a list by interval and adds a pause only between blocks',()=>{expect(smsBatchPreview(plan).jobs.map(j=>j.run_at)).toEqual(['2030-01-01T10:00:00.000Z','2030-01-01T10:00:10.000Z','2030-01-01T10:00:50.000Z','2030-01-01T10:01:00.000Z','2030-01-01T10:01:40.000Z']);});
it('rejects duplicates, attachments and a final recipient beyond expiry',()=>{expect(()=>smsBatchPreview({...plan,contact_ids:[ids[0],ids[0]]})).toThrow();expect(()=>smsBatchPreview({...plan,media:{url:'file'}})).toThrow();expect(()=>smsBatchPreview({...plan,expires_at:'2030-01-01T10:01:00Z'})).toThrow();});
