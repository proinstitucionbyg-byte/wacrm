import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({ role: vi.fn(), can: vi.fn(), from: vi.fn(), update: vi.fn(), eq: vi.fn(), neq: vi.fn(), select: vi.fn(), single: vi.fn() }));
vi.mock('@/lib/auth/permissions', () => ({ requirePermission: mocks.role, canInAccount: mocks.can }));
vi.mock('@/lib/flows/admin-client', () => ({ supabaseAdmin: vi.fn() }));
vi.mock('@/lib/auth/account', () => ({ requireRole: mocks.role, toErrorResponse: (e: { status?: number }) => NextResponse.json({ error: 'denied' }, { status: e.status ?? 500 }) }));
import { PATCH } from './route';
const id = '11111111-1111-4111-8111-111111111111';
const request = (body: unknown) => new Request(`http://localhost/api/payments/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
const context = () => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.resetAllMocks();
  const chain = { update: mocks.update, eq: mocks.eq, neq: mocks.neq, select: mocks.select, maybeSingle: mocks.single };
  for (const fn of [mocks.from,mocks.update,mocks.eq,mocks.neq,mocks.select]) fn.mockReturnValue(chain);
  mocks.role.mockResolvedValue({ accountId: 'account-owner', supabase: { from: mocks.from } });
  mocks.can.mockResolvedValue(true);
  mocks.single.mockResolvedValue({ data: { id, status: 'validated', version: 2 }, error: null });
});
describe('human payment decisions', () => {
  it('requires payment review permission before reading or writing', async () => {
    mocks.role.mockRejectedValue({ status: 403 });
    expect((await PATCH(request({ status: 'validated', note: '', version: 1 }), context())).status).toBe(403);
    expect(mocks.role).toHaveBeenCalledWith('payments', 'review'); expect(mocks.from).not.toHaveBeenCalled();
  });
  it('also requires payment visibility', async () => {
    mocks.can.mockResolvedValue(false);
    expect((await PATCH(request({ status: 'validated', note: '', version: 1 }), context())).status).toBe(403);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it('rejects an observation without a reason', async () => {
    expect((await PATCH(request({ status: 'observation', note: ' ', version: 1 }), context())).status).toBe(400);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it('scopes a human approval to account, version and unlocked status', async () => {
    expect((await PATCH(request({ status: 'validated', note: 'abono comprobado', version: 1 }), context())).status).toBe(200);
    expect(mocks.eq).toHaveBeenCalledWith('account_id', 'account-owner');
    expect(mocks.eq).toHaveBeenCalledWith('version', 1);
    expect(mocks.neq).toHaveBeenCalledWith('status', 'validated');
    expect(mocks.update).toHaveBeenCalledWith({ status: 'validated', note: 'abono comprobado' });
  });
  it('returns conflict when another review already changed the record', async () => {
    mocks.single.mockResolvedValue({ data: null, error: null });
    expect((await PATCH(request({ status: 'validated', note: '', version: 1 }), context())).status).toBe(409);
  });
});
