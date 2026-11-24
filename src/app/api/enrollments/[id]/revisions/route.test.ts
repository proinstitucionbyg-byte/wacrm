import {beforeEach,describe,expect,it,vi} from 'vitest';
const h=vi.hoisted(()=>({permission:vi.fn(),from:vi.fn(),rpc:vi.fn(),draft:null as unknown}));
vi.mock('@/lib/auth/permissions',()=>({requirePermission:h.permission}));
vi.mock('@/lib/auth/account',()=>({toErrorResponse:(e:{status?:number})=>Response.json({error:'Error'},{status:e.status??500})}));
vi.mock('@/lib/flows/admin-client',()=>({supabaseAdmin:()=>({rpc:h.rpc})}));
import {POST} from './route';
const id='11111111-1111-4111-8111-111111111111',account='22222222-2222-4222-8222-222222222222';
const context=()=>({params:Promise.resolve({id})});
const body=()=>({action:'preview',scope:'linked',version:3,patch:{full_name:'Nombre corregido'}});
const req=(b:unknown)=>new Request('https://crm.test/api/enrollments/'+id+'/revisions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});
beforeEach(()=>{
 vi.resetAllMocks();vi.stubEnv('NEXT_PUBLIC_ENROLLMENT_CORRECTIONS_ENABLED','true');h.draft={id,status:'registered',version:3,data:{full_name:'NOMBRE ANTERIOR',document_type:'DNI',document_number:'23018826',email:'prueba@example.com'}};
 const q={select:vi.fn(),eq:vi.fn(),maybeSingle:vi.fn(async()=>({data:h.draft,error:null}))};q.select.mockReturnValue(q);q.eq.mockReturnValue(q);h.from.mockReturnValue(q);
 h.permission.mockResolvedValue({accountId:account,userId:id,supabase:{from:h.from}});h.rpc.mockResolvedValue({data:{id,status:'requested'},error:null});
});
describe('registered revision requests',()=>{
 it('previews without writing or claiming application',async()=>{
  const r=await POST(req(body()),context());expect(r.status).toBe(200);expect((await r.json()).applied).toBe(false);expect(h.rpc).not.toHaveBeenCalled();
 });
 it('rejects stale versions and unregistered records',async()=>{
  expect((await POST(req({...body(),version:2}),context())).status).toBe(409);
  h.draft={id,version:3,status:'processing'};expect((await POST(req(body()),context())).status).toBe(409);expect(h.rpc).not.toHaveBeenCalled();
 });
 it('rejects attempts to forge identity confirmation',async()=>{
  expect((await POST(req({...body(),patch:{identity_confirmed:true}}),context())).status).toBe(400);
 });
 it('requires explicit confirmation and a reason before storing a request',async()=>{
  expect((await POST(req({...body(),action:'request',request_id:id}),context())).status).toBe(400);expect(h.rpc).not.toHaveBeenCalled();
 });
 it('stores a normalized account-scoped audit request, never an applied update',async()=>{
  const r=await POST(req({...body(),action:'request',request_id:id,reason:'Corrección de nombre comprobada.',confirmed:true}),context());
  expect(r.status).toBe(202);expect((await r.json()).applied).toBe(false);
  expect(h.rpc).toHaveBeenCalledWith('request_registered_student_correction',expect.objectContaining({p_account_id:account,p_actor:id,p_patch:{full_name:'NOMBRE CORREGIDO'}}));
 });
 it('enforces edit permission before reading student data',async()=>{
  h.permission.mockRejectedValue({status:403});expect((await POST(req(body()),context())).status).toBe(403);expect(h.from).not.toHaveBeenCalled();
 });
 it('rejects oversized requests before database access',async()=>{
  expect((await POST(req({...body(),reason:'a'.repeat(17000)}),context())).status).toBe(413);expect(h.from).not.toHaveBeenCalled();
 });
 it('rejects invalid corrected contact data',async()=>{
  expect((await POST(req({...body(),patch:{email:'incorrecto'}}),context())).status).toBe(400);expect(h.rpc).not.toHaveBeenCalled();
 });
 it('reports concurrent corrections without claiming success',async()=>{
  h.rpc.mockResolvedValue({data:null,error:{code:'23505'}});
  expect((await POST(req({...body(),action:'request',request_id:id,reason:'Corrección de nombre comprobada.',confirmed:true}),context())).status).toBe(409);
 });
});

it('keeps deferred corrections disabled before reading or writing records',async()=>{vi.stubEnv('NEXT_PUBLIC_ENROLLMENT_CORRECTIONS_ENABLED','false');expect((await POST(req(body()),context())).status).toBe(503);expect(h.from).not.toHaveBeenCalled();expect(h.rpc).not.toHaveBeenCalled();});
