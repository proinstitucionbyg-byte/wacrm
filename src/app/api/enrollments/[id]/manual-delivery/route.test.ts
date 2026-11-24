import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
const h = vi.hoisted(() => ({ permission: vi.fn(), rpc: vi.fn(), admin: vi.fn() }));
vi.mock('@/lib/auth/permissions', () => ({ requirePermission: h.permission }));
vi.mock('@/lib/flows/admin-client', () => ({ supabaseAdmin: h.admin }));
vi.mock('@/lib/auth/account', () => ({ toErrorResponse: (e: { status?: number }) =>
  NextResponse.json({ error: 'denied' }, { status: e.status ?? 500 }) }));
import { POST } from './route';
const id = '11111111-1111-4111-8111-111111111111';
const actor = '22222222-2222-4222-8222-222222222222';
const params = () => ({ params: Promise.resolve({ id }) });
const request = (body: unknown) => new Request('https://crm.test/manual-delivery', {
  method: 'POST', body: JSON.stringify(body),
});
beforeEach(() => {
  vi.resetAllMocks();
  h.permission.mockResolvedValue({ accountId: 'account', userId: actor });
  h.admin.mockReturnValue({ rpc: h.rpc });
  h.rpc.mockResolvedValue({ data: { version: 8, receipt: { sent: true, sent_at: '2026-10-28T06:00:00Z',
    sent_by: actor, folder_url: 'https://drive.google.com/drive/folders/student' } }, error: null });
});
describe('manual delivery mark', () => {
  it('requires edit permission before privileged storage', async () => {
    h.permission.mockRejectedValue({ status: 403 });
    expect((await POST(request({ sent: true, version: 7 }), params())).status).toBe(403);
    expect(h.admin).not.toHaveBeenCalled();
  });
  it.each([{}, { sent: 'true', version: 7 }, { sent: true, version: -1 }, { sent: true, version: 1.1 }])(
    'rejects malformed marks without writing', async body => {
      expect((await POST(request(body), params())).status).toBe(400);
      expect(h.rpc).not.toHaveBeenCalled();
    });
  it('uses the signed-in account and actor, ignoring forged browser fields', async () => {
    const result = await POST(request({ sent: true, version: 7, accountId: 'other', actor: 'other' }), params());
    expect(result.status).toBe(200);
    expect(h.rpc).toHaveBeenCalledWith('set_enrollment_manual_document_delivery', {
      p_account_id: 'account', p_actor: actor, p_enrollment_id: id, p_sent: true, p_expected_version: 7,
    });
    expect(await result.json()).toEqual({ version: 8, manual_delivery: { sent: true,
      sent_at: '2026-10-28T06:00:00Z', sent_by: actor } });
  });
  it.each([['42501', 403], ['P0002', 404], ['40001', 409], ['22023', 409]])(
    'returns actionable permission, missing enrollment and conflict errors', async (code, status) => {
      h.rpc.mockResolvedValue({ data: null, error: { code } });
      expect((await POST(request({ sent: false, version: 7 }), params())).status).toBe(status);
    });
});
