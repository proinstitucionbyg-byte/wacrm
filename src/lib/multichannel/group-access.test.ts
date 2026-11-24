import { beforeEach, expect, it, vi } from 'vitest';
import type { AccountContext } from '@/lib/auth/account';
const h = vi.hoisted(() => ({
  phone: '51900000001',
  grant: null as null | { can_manage: boolean },
  from: vi.fn(),
}));
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({ from: h.from }),
}));
import { requireGroupLineAccess } from './group-access';
const ctx = (role = 'agent') =>
  ({ accountId: 'account', userId: 'agent', role }) as AccountContext;
beforeEach(() => {
  h.phone = '51900000001';
  h.grant = null;
  h.from.mockImplementation((table: string) => {
    const q = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: async () => ({
        error: null,
        data:
          table === 'multichannel_whatsapp_session_lines'
            ? { linked_phone: h.phone }
            : h.grant,
      }),
    };
    q.select.mockReturnValue(q);
    q.eq.mockReturnValue(q);
    return q;
  });
});
it('requires explicit CEO delegation even for administrators', async () => {
  await expect(
    requireGroupLineAccess(ctx('admin'), 'WA-one', h.phone)
  ).rejects.toThrow('CEO');
  h.grant = { can_manage: false };
  await expect(
    requireGroupLineAccess(ctx(), 'WA-one', h.phone)
  ).resolves.toBeUndefined();
  await expect(
    requireGroupLineAccess(ctx(), 'WA-one', h.phone, true)
  ).rejects.toThrow('CEO');
  h.grant.can_manage = true;
  await expect(
    requireGroupLineAccess(ctx(), 'WA-one', h.phone, true)
  ).resolves.toBeUndefined();
});
it('does not carry permissions over when a linked number changes', async () => {
  h.grant = { can_manage: true };
  await expect(
    requireGroupLineAccess(ctx(), 'WA-one', '51900000002')
  ).rejects.toThrow('cambió');
});
