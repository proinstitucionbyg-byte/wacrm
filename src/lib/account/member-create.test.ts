import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ role: vi.fn(), create: vi.fn(), rpc: vi.fn(), ban: vi.fn() }));
vi.mock('@/lib/auth/account', () => ({ requireRole: m.role, toErrorResponse: (e: {status?:number}) => new Response(null,{status:e.status||500}) }));
vi.mock('@/lib/ai/admin-client', () => ({ supabaseAdmin: () => ({auth:{admin:{createUser:m.create,updateUserById:m.ban}},rpc:m.rpc}) }));
vi.mock('@/lib/rate-limit', () => ({checkRateLimit:()=>({success:true}),rateLimitResponse:vi.fn(),RATE_LIMITS:{adminAction:{}}}));
import { POST } from '@/app/api/account/members/create/route';

const valid = {email:'Test@Example.invalid',password:'Test-only-password-123',name:' TEST AGENT ',nickname:' TEST ',preset:'ventas'};
const call = (body: unknown = valid) => POST(new Request('https://crm.test',{method:'POST',body:JSON.stringify(body)}));
beforeEach(()=>{
  vi.resetAllMocks();
  m.role.mockResolvedValue({role:'owner',userId:'ceo',accountId:'account'});
  m.create.mockResolvedValue({data:{user:{id:'new-user'}},error:null});
  m.rpc.mockResolvedValue({error:null});
  m.ban.mockResolvedValue({error:null});
});
describe('create supervised team member',()=>{
  it('requires administrator authentication',async()=>{
    m.role.mockRejectedValue({status:403});
    expect((await call()).status).toBe(403);
    expect(m.create).not.toHaveBeenCalled();
  });
  it('creates only a new user and attaches it to the authenticated account',async()=>{
    const res=await call();
    expect(res.status).toBe(201);
    expect(m.create).toHaveBeenCalledWith({email:'test@example.invalid',password:valid.password,email_confirm:true,user_metadata:{full_name:'TEST AGENT'}});
    expect(m.rpc).toHaveBeenCalledWith('attach_created_team_member',{p_caller:'ceo',p_account:'account',p_user:'new-user',p_preset:'ventas',p_name:'TEST AGENT',p_nickname:'TEST'});
    expect(await res.text()).not.toContain(valid.password);
    expect(m.ban).not.toHaveBeenCalled();
  });
  it.each([
    {email:'invalid'},{password:'short'},{password:'x'.repeat(129)},
    {name:' '},{nickname:' '},{preset:'owner'},
  ])('rejects invalid data before creating credentials: %j',async(change)=>{
    expect((await call({...valid,...change})).status).toBe(400);
    expect(m.create).not.toHaveBeenCalled();
  });
  it('does not allow an administrator to create another administrator',async()=>{
    m.role.mockResolvedValue({role:'admin',userId:'admin',accountId:'account'});
    expect((await call({...valid,preset:'administrador'})).status).toBe(403);
    expect(m.create).not.toHaveBeenCalled();
  });
  it('never resets or adopts an existing registered email',async()=>{
    m.create.mockResolvedValue({data:{user:null},error:{message:'sensitive internal detail'}});
    const res=await call();expect(res.status).toBe(400);
    expect(m.rpc).not.toHaveBeenCalled();expect(m.ban).not.toHaveBeenCalled();
    expect(await res.text()).not.toContain('sensitive internal detail');
  });
  it('blocks only the newly created user when attachment fails',async()=>{
    m.rpc.mockResolvedValue({error:{message:'internal DB detail'}});
    const res=await call();expect(res.status).toBe(500);
    expect(m.ban).toHaveBeenCalledWith('new-user',{ban_duration:'876000h'});
    expect(await res.text()).not.toContain('internal DB detail');
  });
  it('does not claim the new account was blocked when Auth fails to block it',async()=>{
    m.rpc.mockResolvedValue({error:{message:'DB detail'}});
    m.ban.mockResolvedValue({error:{message:'Auth detail'}});
    const res=await call();const body=await res.text();
    expect(res.status).toBe(500);expect(body).toContain('ni confirmar su bloqueo');
    expect(body).not.toContain('Auth detail');
  });
});
