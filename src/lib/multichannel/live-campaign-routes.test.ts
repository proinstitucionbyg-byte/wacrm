import{beforeEach,afterEach,describe,it,expect,vi}from'vitest';
const h=vi.hoisted(()=>({role:vi.fn(),rpc:vi.fn(),from:vi.fn(),worker:vi.fn()}));
vi.mock('@/lib/auth/account',()=>({requireRole:h.role,toErrorResponse:()=>Response.json({error:'No autorizado'},{status:403})}));
vi.mock('@/lib/automations/admin-client',()=>({supabaseAdmin:()=>({rpc:h.rpc,from:h.from})}));
import{POST as owner}from'@/app/api/multichannel/campaigns/route';
import{POST as worker}from'@/app/api/multichannel/campaigns/worker/route';
const id='00000000-0000-4000-8000-000000000001',account='00000000-0000-4000-8000-000000000002';
const plan=()=>({request_id:id,name:'Aviso',purpose:'notice',body:'Aviso revisado',routes:[{channel:'whatsapp_support',line_key:'WA-one'}],run_at:'2027-01-01T09:00:00-05:00',expires_at:'2027-01-01T10:00:00-05:00',interval_seconds:20,block_size:50,block_pause_seconds:300,recipients:[{contact_id:id,permission_expires_at:'2027-01-02T00:00:00Z',evidence:'Permiso revisado por el propietario'}]});
const request=(body:unknown,auth='Bearer wcm_'+'a'.repeat(64))=>new Request('https://crm.example/api/multichannel/campaigns',{method:'POST',headers:{'Content-Type':'application/json',Authorization:auth},body:JSON.stringify(body)});
beforeEach(()=>{
 vi.clearAllMocks();vi.stubEnv('MULTICHANNEL_CAMPAIGNS_ENABLED','true');
 h.role.mockResolvedValue({accountId:account,userId:id});h.rpc.mockResolvedValue({data:{id,status:'draft'},error:null});h.worker.mockResolvedValue({data:{id,account_id:account},error:null});
 const query={select:vi.fn(),eq:vi.fn(),maybeSingle:h.worker};query.select.mockReturnValue(query);query.eq.mockReturnValue(query);h.from.mockReturnValue(query);
});afterEach(()=>vi.unstubAllEnvs());
describe('campaign owner boundary',()=>{
 it('requires owner access before consulting the database',async()=>{h.role.mockRejectedValue(Error('Unauthorized'));expect((await owner(request({action:'create',campaign:plan()}))).status).toBe(403);expect(h.rpc).not.toHaveBeenCalled();});
 it('keeps real campaigns disabled until explicitly configured',async()=>{vi.stubEnv('MULTICHANNEL_CAMPAIGNS_ENABLED','false');expect((await owner(request({}))).status).toBe(503);expect(h.rpc).not.toHaveBeenCalled();});
 it('creates a reviewed draft with server account and a stable fingerprint',async()=>{
  expect((await owner(request({action:'create',campaign:plan()}))).status).toBe(201);const first=h.rpc.mock.calls[0][1];
  expect(first.p_account_id).toBe(account);expect(first.p_actor_id).toBe(id);expect(first.p_payload.review_hash).toMatch(/^[a-f0-9]{64}$/);
  await owner(request({action:'create',campaign:plan()}));expect(h.rpc.mock.calls[1][1].p_payload.review_hash).toBe(first.p_payload.review_hash);
 });
 it('rejects a supplied account or duplicate recipient before queuing',async()=>{
  expect((await owner(request({action:'create',campaign:{...plan(),account_id:'other'}}))).status).toBe(400);
  const p=plan();p.recipients.push(p.recipients[0]);expect((await owner(request({action:'create',campaign:p}))).status).toBe(400);expect(h.rpc).not.toHaveBeenCalled();
 });
 it('maps a conflicting request to a conflict, without leaking DB details',async()=>{
  h.rpc.mockResolvedValue({data:null,error:{code:'23505',message:'PRIVATE DATABASE DETAIL'}});const r=await owner(request({action:'create',campaign:plan()}));expect(r.status).toBe(409);expect(JSON.stringify(await r.json())).not.toContain('PRIVATE');
 });
});
describe('campaign worker boundary',()=>{
 it('rejects missing worker credentials and unknown fields',async()=>{
  expect((await worker(request({action:'claim',line_key:'WA-one',session_phone:'51900000001'},''))).status).toBe(401);
  expect((await worker(request({action:'claim',line_key:'WA-one',session_phone:'51900000001',account_id:account}))).status).toBe(400);expect(h.rpc).not.toHaveBeenCalled();
 });
 it('binds heartbeat to the authenticated worker and its session',async()=>{
  const r=await worker(request({action:'heartbeat',line_key:'WA-one',session_phone:'51900000001',ready:true}));expect(r.status).toBe(200);
  expect(h.rpc).toHaveBeenCalledWith('multichannel_campaign_worker_step',expect.objectContaining({p_worker_id:id,p_line_key:'WA-one',p_session_phone:'51900000001',p_ready:true}));
 });
 it('requires a provider identifier before accepting a claimed delivery',async()=>{
  const r=await worker(request({action:'record',line_key:'WA-one',session_phone:'51900000001',job_id:id,claim_token:id,state:'delivered'}));expect(r.status).toBe(400);expect(h.rpc).not.toHaveBeenCalled();
 });
 it('does not release a permit with a changed body or destination',async()=>{
  h.rpc.mockResolvedValue({data:{allowed:true,job_id:id,chat_id:'51900000002@c.us',body:'Original'},error:null});
  const r=await worker(request({action:'authorize',line_key:'WA-one',session_phone:'51900000001',job_id:id,claim_token:id,chat_id:'51900000002@c.us',body_hash:'a'.repeat(64)}));expect(await r.json()).toEqual({permit:{allowed:false}});
 });
});
