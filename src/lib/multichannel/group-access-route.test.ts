import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({
  role: vi.fn(),
  from: vi.fn(),
  upsert: vi.fn(),
  member: true,
  phone: '51900000001',
}));
vi.mock('@/lib/auth/account', () => ({
  requireRole: h.role,
  toErrorResponse: () =>
    Response.json({ error: 'No autorizado' }, { status: 403 }),
}));
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({ from: h.from }),
}));
import { POST } from '@/app/api/multichannel/whatsapp/groups/access/route';
const account = '22222222-2222-4222-8222-222222222222',
  owner = '11111111-1111-4111-8111-111111111111',
  user = '33333333-3333-4333-8333-333333333333';
const request = () =>
  new Request(
    'https://crm.example.test/api/multichannel/whatsapp/groups/access',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: user,
        line_key: 'WA-one',
        expected_phone: '51900000001',
        access: 'manage',
      }),
    }
  );
beforeEach(() => {
  vi.clearAllMocks();
  h.member = true;
  h.phone = '51900000001';
  h.role.mockResolvedValue({
    accountId: account,
    userId: owner,
    role: 'owner',
  });
  h.upsert.mockResolvedValue({ error: null });
  h.from.mockImplementation((table: string) => {
    const q = {
      select: vi.fn(),
      eq: vi.fn(),
      upsert: h.upsert,
      maybeSingle: async () => ({
        data:
          table === 'profiles'
            ? h.member
              ? { user_id: user, account_role: 'agent' }
              : null
            : { linked_phone: h.phone },
        error: null,
      }),
    };
    q.eq.mockReturnValue(q);
    q.select.mockReturnValue(q);
    return q;
  });
});
afterEach(() => vi.unstubAllEnvs());
it('only the CEO can grant group access', async () => {
  h.role.mockRejectedValue(Error('Denied'));
  expect((await POST(request())).status).toBe(403);
  expect(h.role).toHaveBeenCalledWith('owner');
  expect(h.from).not.toHaveBeenCalled();
});
it('never grants another account member or a changed linked phone', async () => {
  h.member = false;
  expect((await POST(request())).status).toBe(404);
  h.member = true;
  h.phone = '51900000002';
  expect((await POST(request())).status).toBe(409);
  expect(h.upsert).not.toHaveBeenCalled();
});
it('records the CEO and account from the session, scoped to the selected number', async () => {
  expect((await POST(request())).status).toBe(200);
  expect(h.upsert).toHaveBeenCalledWith(
    expect.objectContaining({
      account_id: account,
      user_id: user,
      line_key: 'WA-one',
      linked_phone: '51900000001',
      can_manage: true,
      granted_by: owner,
    }),
    { onConflict: 'account_id,user_id,line_key' }
  );
});
