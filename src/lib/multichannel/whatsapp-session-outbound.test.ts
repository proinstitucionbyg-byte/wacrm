import {beforeEach,describe,it,expect,vi} from 'vitest';
import {sessionPayloadHash} from '../../../scripts/multichannel/whatsapp-session/session-media.mjs';
const mocks=vi.hoisted(()=>({from:vi.fn(),rpc:vi.fn(),stored:vi.fn()}));
vi.mock('@/lib/automations/admin-client',()=>({supabaseAdmin:()=>mocks}));
vi.mock('@/lib/automations/engine',()=>({resumeDeliveredMessage:vi.fn()}));
import {POST} from '@/app/api/multichannel/whatsapp/outbound/route';
const id='1209bcda-05e7-4ca6-965a-716363225abc',claim='1209bcda-05e7-4ca6-965a-716363225abd',line='WA-test';
const media={kind:'audio' as const,url:'https://assets.test/storage/v1/object/public/course.ogg'};
const request=(action:Record<string,unknown>)=>new Request('https://crm.test/api/multichannel/whatsapp/outbound',{method:'POST',headers:{Authorization:`Bearer wcm_${'a'.repeat(64)}`,'Content-Type':'application/json'},body:JSON.stringify({line_key:line,...action})});
beforeEach(()=>{
 vi.resetAllMocks();vi.stubEnv('MULTICHANNEL_WHATSAPP_SESSION_SEND_ENABLED','true');
 mocks.from.mockImplementation(table=>{const query={select:vi.fn(),eq:vi.fn(),maybeSingle:vi.fn()};query.select.mockReturnValue(query);query.eq.mockReturnValue(query);query.maybeSingle.mockImplementation(()=>table==='multichannel_workers'?Promise.resolve({data:{id:'worker',account_id:'account'},error:null}):mocks.stored());return query;});
 mocks.stored.mockResolvedValue({data:{media},error:null});
});
describe('session media worker authorization',()=>{
 it('refuses a legacy worker instead of returning a media placeholder as text',async()=>{
  mocks.rpc.mockResolvedValue({data:{id,claim_token:claim,media},error:null});
  expect((await POST(request({action:'claim'}))).status).toBe(409);
  expect(mocks.rpc).toHaveBeenLastCalledWith('whatsapp_session_outbound_step',expect.objectContaining({p_state:'needs_review',p_job_id:id}));
 });
 it('binds authorization to the exact file and refuses changed media or a missing stored job',async()=>{
  mocks.rpc.mockResolvedValue({data:{allowed:true,job_id:id,account_id:'account',line_key:line,chat_id:'51911111111@c.us',inbound_provider_message_id:'real-inbound',claim_token:claim,body:'Audio',expires_at:new Date(Date.now()+20000).toISOString()},error:null});
  const action={action:'authorize',job_id:id,claim_token:claim,chat_id:'51911111111@c.us',inbound_provider_message_id:'real-inbound',body_hash:sessionPayloadHash('Audio',media)};
  expect((await (await POST(request(action))).json()).permit.allowed).toBe(true);
  expect((await (await POST(request({...action,body_hash:sessionPayloadHash('Audio',{...media,url:media.url+'2'})}))).json()).permit.allowed).toBe(false);
  mocks.stored.mockResolvedValue({data:null,error:null});expect((await (await POST(request(action))).json()).permit.allowed).toBe(false);
 });
});
