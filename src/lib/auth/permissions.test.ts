import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ current: vi.fn(), rpc: vi.fn() }));
vi.mock('./account', () => ({ getCurrentAccount: mock.current, ForbiddenError: class extends Error { status = 403; } }));
import { requirePermission } from './permissions';
const ctx = { userId: 'member', accountId: 'account', role: 'agent', account: { id: 'account', name: 'CRM' }, supabase: { rpc: mock.rpc } };
beforeEach(() => { vi.resetAllMocks(); mock.current.mockResolvedValue(ctx); mock.rpc.mockResolvedValue({ data: true, error: null }); });
describe('server permissions', () => {
  it('uses the database permission of the signed-in user', async () => {
    expect(await requirePermission('payments', 'view')).toBe(ctx);
    expect(mock.rpc).toHaveBeenCalledWith('has_member_permission', { p_user_id: 'member', p_module: 'payments', p_action: 'view' });
  });
  it('denies before returning context when the permission is absent', async () => {
    mock.rpc.mockResolvedValue({ data: false, error: null });
    await expect(requirePermission('payments', 'view')).rejects.toMatchObject({ status: 403 });
  });
  it('a review permission does not bypass a denied view permission', async () => {
    mock.rpc.mockResolvedValueOnce({ data: true, error: null }).mockResolvedValueOnce({ data: false, error: null });
    await expect(requirePermission('payments', 'review')).rejects.toMatchObject({ status: 403 });
  });
  it('requires both enrollment edit and view', async () => {
    await requirePermission('enrollments', 'edit');
    expect(mock.rpc).toHaveBeenCalledTimes(2);
  });
  it('fails closed on a database error', async () => {
    mock.rpc.mockResolvedValue({ data: true, error: new Error('database offline') });
    await expect(requirePermission('payments', 'view')).rejects.toThrow('database offline');
  });
});
