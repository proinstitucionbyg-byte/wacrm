import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
const mocks = vi.hoisted(() => ({
  permission: vi.fn(),
  from: vi.fn(),
  eq: vi.fn(),
  single: vi.fn(),
  collect: vi.fn(),
  admin: {},
}));
vi.mock('@/lib/auth/permissions', () => ({
  requirePermission: mocks.permission,
}));
vi.mock('@/lib/auth/account', () => ({
  toErrorResponse: (e: { status?: number }) =>
    NextResponse.json({ error: 'denied' }, { status: e.status ?? 500 }),
}));
vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => mocks.admin,
}));
vi.mock('@/lib/matriculas/collect', () => ({
  collectConversationEnrollments: mocks.collect,
}));
import { POST } from './route';
const context = { params: Promise.resolve({ id: 'chosen' }) };
const request = (body?: unknown) =>
  new Request('http://localhost/api/enrollments/chosen/collect', {
    method: 'POST',
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
beforeEach(() => {
  vi.resetAllMocks();
  const chain = { select: vi.fn(), eq: mocks.eq, maybeSingle: mocks.single };
  chain.select.mockReturnValue(chain);
  mocks.eq.mockReturnValue(chain);
  mocks.from.mockReturnValue(chain);
  mocks.permission.mockResolvedValue({
    accountId: 'account',
    supabase: { from: mocks.from },
  });
  mocks.single.mockResolvedValue({
    data: {
      conversation_id: 'chat',
      version: 4,
      data: { course: 'NUTRICION Y DIETETICA' },
    },
    error: null,
  });
});
describe('explicit enrollment collection', () => {
  it('checks permission before reading or using the service client', async () => {
    mocks.permission.mockRejectedValue({ status: 403 });
    expect((await POST(request(), context)).status).toBe(403);
    expect(mocks.permission).toHaveBeenCalledWith('enrollments', 'edit');
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.collect).not.toHaveBeenCalled();
  });
  it('scopes the chosen record and passes only its conversation and id', async () => {
    expect(
      (await POST(request({ selected: true, version: 4 }), context)).status
    ).toBe(200);
    expect(mocks.eq).toHaveBeenCalledWith('account_id', 'account');
    expect(mocks.eq).toHaveBeenCalledWith('id', 'chosen');
    expect(mocks.collect).toHaveBeenCalledWith(
      mocks.admin,
      'account',
      'chat',
      'chosen'
    );
  });
  it('preserves automatic single-draft collection when no selection is sent', async () => {
    expect((await POST(request(), context)).status).toBe(200);
    expect(mocks.collect).toHaveBeenCalledWith(
      mocks.admin,
      'account',
      'chat',
      undefined
    );
  });
  it('rejects an outdated selection', async () => {
    expect(
      (await POST(request({ selected: true, version: 3 }), context)).status
    ).toBe(409);
    expect(mocks.collect).not.toHaveBeenCalled();
  });
  it('requires a saved recognized course', async () => {
    mocks.single.mockResolvedValue({
      data: {
        conversation_id: 'chat',
        version: 4,
        data: { course: 'unknown' },
      },
      error: null,
    });
    expect(
      (await POST(request({ selected: true, version: 4 }), context)).status
    ).toBe(409);
    expect(mocks.collect).not.toHaveBeenCalled();
  });
  it('cannot select a draft outside the authenticated scope', async () => {
    mocks.single.mockResolvedValue({ data: null, error: null });
    expect(
      (await POST(request({ selected: true, version: 4 }), context)).status
    ).toBe(404);
    expect(mocks.collect).not.toHaveBeenCalled();
  });
  it('does not claim success if collection fails', async () => {
    mocks.collect.mockRejectedValue(new Error('database'));
    expect((await POST(request(), context)).status).toBe(500);
  });
});
