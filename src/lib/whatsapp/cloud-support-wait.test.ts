import {beforeEach,describe,it,expect,vi} from 'vitest';
const h=vi.hoisted(()=>({dispatch:vi.fn(),route:vi.fn(),referral:null as unknown,answered:false,paused:false,cleared:false,updates:[] as {status:string;result:string}[]}));
vi.mock('./inbound-dispatch',()=>({dispatchInboundThroughCrm:h.dispatch}));
vi.mock('./cloud-support',()=>({routeCloudSupportOpening:h.route}));
import {drainSupportWaits} from './cloud-support-wait';
beforeEach(()=>{vi.clearAllMocks();h.referral=null;h.answered=false;h.paused=false;h.cleared=false;h.updates=[];h.route.mockResolvedValue(true);h.dispatch.mockResolvedValue(undefined);});
function db(){return {rpc:vi.fn(async()=>({data:[{id:'wait',account_id:'account',conversation_id:'chat',source_message_id:'source',first_inbound:true,contact_created:true}],error:null})),from:(table:string)=>{
 let source=false;
 const q={select:(fields:string)=>{source=fields.includes('message_id');return q;},eq:vi.fn(),in:vi.fn(),gte:vi.fn(),limit:vi.fn(),
  update:(value:{status:string;result:string})=>{if(value.status)h.updates.push(value);if('whatsapp_support_wait_until' in value)h.cleared=true;return q;},
  maybeSingle:async()=>({data:table==='conversations'?{contact_id:'contact',user_id:'owner',automation_enabled:!h.paused,ai_enabled:true,first_ad_referral:h.referral,whatsapp_support_line_key:null}:source?{message_id:'wamid.original',content_text:'Información',source_referral:h.referral,created_at:'2026-11-04T10:00:00Z',interactive_reply_id:null}:h.answered?{id:'actual-reply'}:null,error:null}),
  then:(fn:(v:unknown)=>unknown)=>Promise.resolve({data:null,error:null}).then(fn)};
 for(const key of ['eq','in','gte','limit'] as const)q[key].mockReturnValue(q);return q;
}} as never;}
describe('late Meta classification',()=>{
 it('uses actual late ad evidence to resume the CRM instead of opening support',async()=>{
  h.referral={source_type:'ad',source_id:'actual-ad'};h.dispatch.mockImplementation(async()=>{expect(h.cleared).toBe(true);});await drainSupportWaits(db());
  expect(h.dispatch).toHaveBeenCalledWith(expect.objectContaining({messageId:'wamid.original',hasConfirmedAdOrigin:true}));expect(h.route).not.toHaveBeenCalled();expect(h.updates[0].result).toBe('campaign_confirmed_preserved');
 });
 it('transfers only after the durable deadline has been claimed and rechecks the original source',async()=>{
  await drainSupportWaits(db());expect(h.route).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({metaWaitExpired:true,messageId:'wamid.original'}));expect(h.dispatch).not.toHaveBeenCalled();
 });
 it('does not answer twice when an adviser already replied during the wait',async()=>{
  h.answered=true;await drainSupportWaits(db());expect(h.route).not.toHaveBeenCalled();expect(h.dispatch).not.toHaveBeenCalled();expect(h.updates[0].status).toBe('cancelled');
 });
 it('preserves an explicit pause set while waiting',async()=>{h.paused=true;await drainSupportWaits(db());expect(h.route).not.toHaveBeenCalled();expect(h.dispatch).not.toHaveBeenCalled();expect(h.updates[0].status).toBe('cancelled');});
});
