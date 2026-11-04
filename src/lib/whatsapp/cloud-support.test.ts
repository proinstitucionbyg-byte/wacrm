import{beforeEach,afterEach,describe,it,expect,vi}from'vitest';
const h=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn(),policy:{enabled:true} as {enabled:boolean}|null,referral:null as unknown,steps:[{step_type:'send_message',step_config:{text:'Bienvenido. ¿En qué te ayudamos?'}},{step_type:'send_buttons',step_config:{kind:'buttons',body:'Elige',buttons:[{id:'actual-sales-branch',title:'Ventas'},{id:'actual-support-branch',title:'Soporte'}]}}]}));
vi.mock('./billing-runtime',()=>({readConversationBillingPreflight:vi.fn(async()=>({automatic_send_allowed:true}))}));
import{routeCloudSupportOpening}from'./cloud-support';
const args={accountId:'account',conversationId:'chat',contactId:'contact',userId:'owner',messageId:'wamid.original',hasConfirmedAdOrigin:false,metaWaitExpired:true};
beforeEach(()=>{
 vi.clearAllMocks();vi.stubEnv('MULTICHANNEL_CLOUD_SUPPORT_ENABLED','true');h.policy={enabled:true};h.referral=null;
 h.rpc.mockResolvedValue({data:{handled:true,state:'queued',waiting:true},error:null});
 h.from.mockImplementation((table:string)=>{
  const data=table==='whatsapp_support_routes'?h.policy:table==='conversations'?{first_ad_referral:h.referral}:table==='automations'?{id:'original-greeting'}:table==='tags'?{id:'existing-tag'}:null;
  const q={select:vi.fn(),eq:vi.fn(),is:vi.fn(),in:vi.fn(),not:vi.fn(),gte:vi.fn(),limit:vi.fn(),order:vi.fn(),upsert:vi.fn(),maybeSingle:async()=>({data,error:null}),then:(fn:(v:unknown)=>unknown)=>Promise.resolve({data:table==='automation_steps'?h.steps:null,error:null}).then(fn)};
  for(const key of ['select','eq','is','in','not','gte','limit','order','upsert'] as const)q[key].mockReturnValue(q);return q;
 });
});afterEach(()=>vi.unstubAllEnvs());
const db={from:h.from,rpc:h.rpc}as never;
describe('Cloud to owner-configured support line',()=>{
 it('durably waits before transferring a first non-campaign question and does not send a greeting yet',async()=>{
  expect(await routeCloudSupportOpening(db,{...args,metaWaitExpired:false,isFirstInboundMessage:true,contentText:'Quiero información de farmacia'})).toBe(true);
  expect(h.rpc).toHaveBeenCalledWith('enqueue_whatsapp_support_wait',expect.objectContaining({p_provider_id:'wamid.original',p_first_inbound:true}));
  expect(h.rpc).not.toHaveBeenCalledWith('enqueue_cloud_support_opening',expect.anything());
 });
 it('routes a genuinely new non-campaign number to support even if its first question asks for a course',async()=>{
  expect(await routeCloudSupportOpening(db,{...args,isFirstInboundMessage:true,contentText:'Quiero información de recursos humanos'})).toBe(true);
  expect(h.rpc).toHaveBeenCalledWith('enqueue_cloud_support_opening',expect.anything());
 });
 it('keeps an eligible commercial button journey on Cloud instead of resetting it to support',async()=>{
  expect(await routeCloudSupportOpening(db,{...args,interactiveReplyId:'original-commercial-button'})).toBe(false);expect(h.rpc).not.toHaveBeenCalled();
  expect(await routeCloudSupportOpening(db,{...args,contentText:'Quiero información de recursos humanos'})).toBe(false);expect(h.rpc).not.toHaveBeenCalled();
 });
 it('reuses the original greeting and numbered CRM branches without Cloud sends',async()=>{
  expect(await routeCloudSupportOpening(db,args)).toBe(true);
  expect(h.rpc).toHaveBeenCalledWith('enqueue_cloud_support_opening',expect.objectContaining({p_account_id:'account',p_conversation_id:'chat',p_provider_id:'wamid.original',p_body:expect.stringContaining('1. Ventas'),p_options:[{id:'actual-sales-branch',title:'Ventas'},{id:'actual-support-branch',title:'Soporte'}]}));
 });
 it('leaves confirmed campaign contacts on their existing commercial route',async()=>{
  expect(await routeCloudSupportOpening(db,{...args,hasConfirmedAdOrigin:true})).toBe(false);expect(h.from).not.toHaveBeenCalled();
  h.referral={source_type:'ad',source_id:'confirmed-ad'};expect(await routeCloudSupportOpening(db,args)).toBe(false);expect(h.rpc).not.toHaveBeenCalled();
 });
 it('does not activate the feature without its explicit server flag',async()=>{vi.stubEnv('MULTICHANNEL_CLOUD_SUPPORT_ENABLED','');expect(await routeCloudSupportOpening(db,args)).toBe(false);expect(h.from).not.toHaveBeenCalled();});
 it('keeps no-line outcomes handled rather than falling back to API quota',async()=>{h.rpc.mockResolvedValue({data:{handled:true,state:'no_ready_line'},error:null});expect(await routeCloudSupportOpening(db,args)).toBe(true);});
 it('fails closed if the transfer cannot be saved',async()=>{h.rpc.mockResolvedValue({data:null,error:Error('failed')});await expect(routeCloudSupportOpening(db,args)).rejects.toThrow('derivación');});
});
