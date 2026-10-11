import {beforeEach,describe,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({role:vi.fn(),rpc:vi.fn()}));
vi.mock('@/lib/auth/account',()=>({requireRole:m.role,toErrorResponse:(e:{status?:number})=>new Response(null,{status:e.status||500})}));
vi.mock('@/lib/rate-limit',()=>({checkRateLimit:()=>({success:true}),rateLimitResponse:vi.fn(),RATE_LIMITS:{adminAction:{}}}));
import {POST} from '@/app/api/account/members/[userId]/preset/route';
const call=(preset:unknown='ventas')=>POST(new Request('https://crm.test',{method:'POST',body:JSON.stringify({preset})}),{params:Promise.resolve({userId:'target'})});
beforeEach(()=>{vi.resetAllMocks();m.role.mockResolvedValue({supabase:{rpc:m.rpc}});m.rpc.mockResolvedValue({error:null});});
describe('apply team permission preset',()=>{
  it('requires admin authentication',async()=>{m.role.mockRejectedValue({status:403});expect((await call()).status).toBe(403);expect(m.rpc).not.toHaveBeenCalled();});
  it.each(['ventas','fidelizacion','coordinador','administrador'])('uses the guarded database function for %s',async(preset)=>{expect((await call(preset)).status).toBe(200);expect(m.rpc).toHaveBeenCalledWith('apply_member_preset',{p_user_id:'target',p_preset:preset});});
  it.each(['owner','',null,{}])('rejects an unknown preset %j',async(preset)=>{expect((await call(preset)).status).toBe(400);expect(m.rpc).not.toHaveBeenCalled();});
  it('preserves database access denials and hides database details',async()=>{m.rpc.mockResolvedValue({error:{code:'42501',message:'private DB detail'}});const res=await call();expect(res.status).toBe(403);expect(await res.text()).not.toContain('private DB detail');});
  it('does not report success after another database failure',async()=>{m.rpc.mockResolvedValue({error:{code:'22023'}});expect((await call()).status).toBe(400);});
});
