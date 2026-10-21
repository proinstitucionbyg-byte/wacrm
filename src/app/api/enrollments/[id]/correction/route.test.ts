import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  permission: vi.fn(),
  admin: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({
  toErrorResponse: (error: { status?: number; message?: string }) =>
    NextResponse.json(
      { error: error.message ?? 'denied' },
      { status: error.status ?? 500 }
    ),
}));
vi.mock('@/lib/auth/permissions', () => ({
  requirePermission: mocks.permission,
}));
vi.mock('@/lib/flows/admin-client', () => ({ supabaseAdmin: mocks.admin }));

import { POST } from './route';

const id = '11111111-1111-4111-8111-111111111111';
const context = () => ({ params: Promise.resolve({ id }) });
const request = (body: unknown) =>
  new Request(`http://localhost/api/enrollments/${id}/correction`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
const validBody = {
  expected_promotion: 'OFERTA 19.90 + 5 CUOTAS 79.90',
  corrected_promotion: 'OFERTA 19.90 + 5 CUOTAS 49.90',
  corrected_prices: [19.9, 49.9, 49.9, 49.9, 49.9, 49.9],
  reason: 'La última promoción comprobada antes del pago fue 49.90.',
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.permission.mockResolvedValue({
    accountId: 'account-a',
    userId: 'user-a',
  });
  mocks.admin.mockReturnValue({ rpc: mocks.rpc });
  mocks.rpc.mockResolvedValue({ data: { id }, error: null });
});

describe('registered enrollment correction route', () => {
  it('requires enrollment edit permission', async () => {
    mocks.permission.mockRejectedValue({ status: 403 });
    expect((await POST(request(validBody), context())).status).toBe(403);
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it('rejects incomplete correction evidence', async () => {
    expect(
      (
        await POST(
          request({ ...validBody, corrected_prices: [19.9, 49.9] }),
          context()
        )
      ).status
    ).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('uses the service-only audited RPC with the current account and actor', async () => {
    expect((await POST(request(validBody), context())).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith(
      'correct_registered_enrollment_offer',
      expect.objectContaining({
        p_enrollment_id: id,
        p_account_id: 'account-a',
        p_actor: 'user-a',
        p_corrected_prices: validBody.corrected_prices,
      })
    );
  });
});
