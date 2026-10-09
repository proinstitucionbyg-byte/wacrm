import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  role: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  update: vi.fn(),
  in: vi.fn(),
  order: vi.fn(),
  limit: vi.fn(),
  single: vi.fn(),
}));
vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.role,
  toErrorResponse: (e: { status?: number }) =>
    NextResponse.json({ error: 'denied' }, { status: e.status ?? 500 }),
}));
import { GET, PATCH } from './route';
const id = '11111111-1111-4111-8111-111111111111';
const context = () => ({ params: Promise.resolve({ id }) });
const request = (body: unknown) =>
  new Request(`http://localhost/api/enrollments/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.resetAllMocks();
  const chain = {
    select: mocks.select,
    eq: mocks.eq,
    update: mocks.update,
    in: mocks.in,
    order: mocks.order,
    limit: mocks.limit,
    maybeSingle: mocks.single,
  };
  for (const fn of [
    mocks.from,
    mocks.select,
    mocks.eq,
    mocks.update,
    mocks.order,
  ])
    fn.mockReturnValue(chain);
  mocks.role.mockResolvedValue({
    accountId: 'account-a',
    supabase: { from: mocks.from },
  });
  mocks.single
    .mockResolvedValueOnce({
      data: { id, conversation_id: 'conv-a', status: 'collecting', data: {} },
      error: null,
    })
    .mockResolvedValue({ data: { id, version: 2, data: {} }, error: null });
  mocks.in.mockResolvedValue({ data: [{ id }], error: null });
  mocks.limit.mockResolvedValue({ data: [], error: null });
});
describe('post-validation enrollment draft', () => {
  it('requires an agent before any data access', async () => {
    mocks.role.mockRejectedValue({ status: 403 });
    expect(
      (await PATCH(request({ data: {}, version: 1 }), context())).status
    ).toBe(403);
    expect(mocks.role).toHaveBeenCalledWith('agent');
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it('loads only the current account draft and its inbound images', async () => {
    expect((await GET(new Request('http://localhost'), context())).status).toBe(
      200
    );
    expect(mocks.eq).toHaveBeenCalledWith('account_id', 'account-a');
    expect(mocks.eq).toHaveBeenCalledWith('conversation_id', 'conv-a');
    expect(mocks.eq).toHaveBeenCalledWith('sender_type', 'customer');
  });
  it('rejects malformed data without querying', async () => {
    expect(
      (await PATCH(request({ data: { phone1: 123 }, version: 1 }), context()))
        .status
    ).toBe(400);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it('blocks registered drafts', async () => {
    mocks.single
      .mockReset()
      .mockResolvedValue({ data: { status: 'registered' }, error: null });
    expect(
      (await PATCH(request({ data: {}, version: 1 }), context())).status
    ).toBe(409);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('rejects evidence from another conversation', async () => {
    mocks.in.mockResolvedValue({ data: [], error: null });
    expect(
      (
        await PATCH(
          request({ data: { identity_message_ids: [id] }, version: 1 }),
          context()
        )
      ).status
    ).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('saves only data with account and version checks', async () => {
    expect(
      (
        await PATCH(
          request({ data: { full_name: 'luis   brayan' }, version: 1 }),
          context()
        )
      ).status
    ).toBe(200);
    expect(mocks.eq).toHaveBeenCalledWith('account_id', 'account-a');
    expect(mocks.eq).toHaveBeenCalledWith('version', 1);
    const payload = mocks.update.mock.calls[0][0];
    expect(Object.keys(payload)).toEqual(['data']);
    expect(payload.data.full_name).toBe('LUIS BRAYAN');
    expect(
      mocks.from.mock.calls.every(([table]) => table !== 'payment_reviews')
    ).toBe(true);
  });
  it('does not accept the voucher as identity evidence', async () => {
    mocks.in.mockResolvedValue({
      data: [{ id, image_analysis: { category: 'payment_receipt' } }],
      error: null,
    });
    expect(
      (
        await PATCH(
          request({ data: { identity_message_ids: [id] }, version: 1 }),
          context()
        )
      ).status
    ).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('does not overwrite a concurrent edit', async () => {
    mocks.single
      .mockReset()
      .mockResolvedValueOnce({ data: { status: 'collecting' }, error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    expect(
      (await PATCH(request({ data: {}, version: 1 }), context())).status
    ).toBe(409);
  });
});
