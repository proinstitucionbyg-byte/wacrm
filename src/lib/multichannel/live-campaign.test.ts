import{describe,it,expect}from'vitest';
import{liveCampaignSchedule,liveCampaignSchema}from'./live-campaign';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const base=()=>({request_id:id(1),name:'Avisos',purpose:'notice',body:'Aviso autorizado',routes:[{channel:'whatsapp_support',line_key:'WA-one'},{channel:'whatsapp_support',line_key:'WA-two'},{channel:'sms',line_key:'SMS-last'}],run_at:'2027-01-01T09:00:00-05:00',expires_at:'2027-01-01T10:00:00-05:00',interval_seconds:10,block_size:2,block_pause_seconds:60,recipients:[2,3,4].map(n=>({contact_id:id(n),permission_expires_at:'2027-01-02T00:00:00Z',evidence:'Permiso revisado'}))});
describe('real campaign schedule',()=>{
 it('keeps Lima offsets and adds the configured block pause',()=>{
  expect(liveCampaignSchedule(base(),0).jobs.map(j=>j.run_at)).toEqual(['2027-01-01T14:00:00.000Z','2027-01-01T14:00:10.000Z','2027-01-01T14:01:20.000Z']);
 });
 it('rejects duplicate contacts and lines instead of sending twice',()=>{
  const a=base();a.recipients.push(a.recipients[0]);expect(liveCampaignSchema.safeParse(a).success).toBe(false);
  const b=base();b.routes.push(b.routes[0]);expect(liveCampaignSchema.safeParse(b).success).toBe(false);
 });
 it('never puts SMS ahead of an available WhatsApp fallback',()=>{
  const a=base();a.routes.reverse();expect(liveCampaignSchema.safeParse(a).success).toBe(false);
 });
 it('rejects batches that outlive expiry or their permission',()=>{
  const a=base();a.block_pause_seconds=7200;expect(liveCampaignSchema.safeParse(a).success).toBe(false);
  const b=base();b.recipients[0].permission_expires_at=b.expires_at;expect(liveCampaignSchema.safeParse(b).success).toBe(false);
 });
 it('does not accept implicit timezones, arbitrary transport fields or expired campaigns',()=>{
  expect(liveCampaignSchema.safeParse({...base(),run_at:'2027-01-01T09:00:00'}).success).toBe(false);
  expect(liveCampaignSchema.safeParse({...base(),mode:'simulation'}).success).toBe(false);
  expect(()=>liveCampaignSchedule(base(),Date.parse('2028-01-01'))).toThrow('venció');
 });
});
