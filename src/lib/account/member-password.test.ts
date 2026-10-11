import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ role: vi.fn(), single: vi.fn(), update: vi.fn(), eq: vi.fn() }));
vi.mock('@/lib/auth/account', () => ({ requireRole: m.role, toErrorResponse: (e: {status?: number}) => new Response(null, {status: e.status || 500}) }));
vi.mock('@/lib/ai/admin-client', () => ({ supabaseAdmin: () => ({auth: {admin: {updateUserById: m.update}}}) }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: () => ({success: true}), rateLimitResponse: vi.fn(), RATE_LIMITS: {adminAction: {}} }));
import { POST } from '@/app/api/account/members/[userId]/password/route';
const id = '11111111-1111-4111-8111-111111111111';
const password = 'Test-only-password-123';
const req = (value: unknown = password) => new Request('https://crm.test', {method:'POST', body: JSON.stringify({password: value})});
const call = (value: unknown = password, target = id) => POST(req(value), {params: Promise.resolve({userId:target})});
beforeEach(() => {
  vi.resetAllMocks();
  const chain = {select: () => chain, eq: m.eq, maybeSingle:m.single};
  m.eq.mockReturnValue(chain);
  m.role.mockResolvedValue({role:'owner', userId:'ceo', accountId:'account', supabase:{from: () => chain}});
  m.single.mockResolvedValue({data:{account_role:'agent'}});
  m.update.mockResolvedValue({error:null});
});
describe('member password reset', () => {
  it('requires admin authentication', async () => {
    m.role.mockRejectedValue({status:403});
    expect((await call()).status).toBe(403);
    expect(m.update).not.toHaveBeenCalled();
  });
  it('scopes the target to the caller account and never returns the password', async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(m.eq).toHaveBeenCalledWith('account_id','account');
    expect(m.eq).toHaveBeenCalledWith('user_id',id);
    expect(m.update).toHaveBeenCalledWith(id,{password});
    expect(await res.text()).not.toContain(password);
  });
  it('rejects targets outside the account', async () => {
    m.single.mockResolvedValue({data:null});
    expect((await call()).status).toBe(404);
    expect(m.update).not.toHaveBeenCalled();
  });
  it('protects the owner', async () => {
    m.single.mockResolvedValue({data:{account_role:'owner'}});
    expect((await call()).status).toBe(403);
    expect(m.update).not.toHaveBeenCalled();
  });
  it('an admin cannot reset another admin', async () => {
    const ctx = await m.role(); m.role.mockResolvedValue({...ctx,role:'admin'});
    m.single.mockResolvedValue({data:{account_role:'admin'}});
    expect((await call()).status).toBe(403);
    expect(m.update).not.toHaveBeenCalled();
  });
  it('allows the CEO to reset an admin', async () => {
    m.single.mockResolvedValue({data:{account_role:'admin'}});
    expect((await call()).status).toBe(200);
  });
  it.each(['short', '', 123, 'x'.repeat(129)])('rejects invalid password %s', async (value) => {
    expect((await call(value)).status).toBe(400);
    expect(m.update).not.toHaveBeenCalled();
  });
  it('uses own-profile settings for a self reset', async () => {
    const ctx = await m.role(); m.role.mockResolvedValue({...ctx,userId:id});
    expect((await call()).status).toBe(400);
    expect(m.update).not.toHaveBeenCalled();
  });
  it('fails closed on a lookup error', async () => {
    m.single.mockResolvedValue({data:null,error:{message:'DB failure'}});
    expect((await call()).status).toBe(500);
    expect(m.update).not.toHaveBeenCalled();
  });
  it('does not expose Auth details', async () => {
    m.update.mockResolvedValue({error:{message:'internal detail'}});
    const res = await call(); expect(res.status).toBe(400);
    expect(await res.text()).not.toContain('internal detail');
  });
});
