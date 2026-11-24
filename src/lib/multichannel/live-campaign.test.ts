import{describe,it,expect}from'vitest';
import{liveCampaignSchedule,liveCampaignSchema,assertCampaignMediaOwnership}from'./live-campaign';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const base=()=>({request_id:id(1),name:'Avisos',purpose:'notice',body:'Aviso autorizado',routes:[{channel:'whatsapp_support',line_key:'WA-one'},{channel:'whatsapp_support',line_key:'WA-two'},{channel:'sms',line_key:'SMS-last'}],run_at:'2027-01-01T09:00:00-05:00',expires_at:'2027-01-01T10:00:00-05:00',interval_seconds:10,block_size:2,block_pause_seconds:60,recipients:[2,3,4].map(n=>({contact_id:id(n),permission_expires_at:'2027-01-02T00:00:00Z',evidence:'Permiso revisado'}))});
describe('real campaign schedule',()=>{
 it('accepts only the current account media on the configured storage origin',()=>{
  const value={...base(),routes:[{channel:'whatsapp_support',line_key:'WA-one'}],sequence:[{body:'Archivo',delay_seconds:0,media:{kind:'image',url:`https://assets.example.test/storage/v1/object/public/flow-media/account-${id(2)}/course.png`}}]};
  const plan=liveCampaignSchema.parse(value);
  expect(()=>assertCampaignMediaOwnership(plan,id(2),'https://assets.example.test')).not.toThrow();
  expect(()=>assertCampaignMediaOwnership(plan,id(3),'https://assets.example.test')).toThrow('cuenta');
  expect(()=>assertCampaignMediaOwnership(plan,id(2),'https://other.example.test')).toThrow('cuenta');
 });
 it('accepts an ordered media sequence only with an explicit SMS text when SMS is a fallback',()=>{
  const sequence=[{body:'Imagen del curso',media:{kind:'image',url:'https://assets.example.test/storage/v1/object/public/course.png'},delay_seconds:0},{body:'Audio',media:{kind:'audio',url:'https://assets.example.test/storage/v1/object/public/course.ogg'},delay_seconds:60}];
  expect(liveCampaignSchema.safeParse({...base(),sequence}).success).toBe(false);
  expect(liveCampaignSchema.safeParse({...base(),sequence,sms_body:'Consulta el curso con tu asesora.'}).success).toBe(true);
  expect(liveCampaignSchema.safeParse({...base(),sequence:[{...sequence[0],delay_seconds:1}],sms_body:'Texto'}).success).toBe(false);
  expect(liveCampaignSchema.safeParse({...base(),sequence:[{...sequence[0],media:{...sequence[0].media,url:'https://user:secret@example.test/file'}}],sms_body:'Texto'}).success).toBe(false);
 });
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

describe('explicit WhatsApp ranges',()=>{
 it('starts separate parallel lanes together while preserving each lane order',()=>{const value={...base(),dispatch_mode:'parallel',distribution:[{from:1,to:2,line_key:'WA-one'},{from:3,to:3,line_key:'WA-two'}]};const jobs=liveCampaignSchedule(value,0).jobs;expect(jobs.map(j=>j.line_key)).toEqual(['WA-one','WA-one','WA-two']);expect(jobs.map(j=>j.run_at)).toEqual(['2027-01-01T14:00:00.000Z','2027-01-01T14:00:10.000Z','2027-01-01T14:00:00.000Z']);});
 it('rejects overlap, gaps, missing recipients and lines outside the selected routes',()=>{for(const distribution of [[{from:1,to:2,line_key:'WA-one'},{from:2,to:3,line_key:'WA-two'}],[{from:1,to:1,line_key:'WA-one'},{from:3,to:3,line_key:'WA-two'}],[{from:1,to:2,line_key:'WA-one'}],[{from:1,to:3,line_key:'WA-other'}]])expect(liveCampaignSchema.safeParse({...base(),distribution}).success).toBe(false);expect(liveCampaignSchema.safeParse({...base(),dispatch_mode:'parallel'}).success).toBe(false);});
});

it('validates the final window against the longest parallel lane',()=>{const p={...base(),dispatch_mode:'parallel',distribution:[{from:1,to:2,line_key:'WA-one'},{from:3,to:3,line_key:'WA-two'}],expires_at:'2027-01-01T09:00:11-05:00'};expect(liveCampaignSchema.safeParse(p).success).toBe(true);expect(liveCampaignSchema.safeParse({...p,dispatch_mode:'sequential'}).success).toBe(false);});
