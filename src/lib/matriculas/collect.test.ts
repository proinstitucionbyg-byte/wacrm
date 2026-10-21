import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
vi.mock('./paid-intake-handoff', () => ({ syncPaidEnrollmentHandoff: vi.fn() }));
import { collectConversationEnrollments } from './collect';
import { syncPaidEnrollmentHandoff } from './paid-intake-handoff';
const from = vi.fn();
const eq = vi.fn();
const update = vi.fn();
const gte = vi.fn();
const limit = vi.fn();
const maybeSingle = vi.fn();
let drafts: unknown[];
const chain = {
  select: vi.fn(),
  eq,
  update,
  gte,
  order: vi.fn(),
  limit,
  maybeSingle,
};
const db = { from } as unknown as SupabaseClient;
beforeEach(() => {
  vi.resetAllMocks();
  drafts = [
    {
      id: 'draft',
      review_id: 'review',
      version: 2,
      data: { phone1: '51987000000' },
    },
  ];
  from.mockReturnValue(chain);
  chain.select.mockReturnValue(chain);
  update.mockReturnValue(chain);
  gte.mockReturnValue(chain);
  chain.order.mockReturnValue(chain);
  eq.mockImplementation((_key, value) =>
    value === 'collecting' && !update.mock.calls.length
      ? Promise.resolve({ data: drafts, error: null })
      : chain
  );
  maybeSingle.mockResolvedValue({
    data: { status: 'validated', created_at: '2026-10-09T00:00:00Z' },
    error: null,
  });
  limit.mockResolvedValue({
    data: [{ id: 'text', content_text: 'correo: uno@gmail.com' }],
    error: null,
  });
  vi.mocked(syncPaidEnrollmentHandoff).mockResolvedValue(undefined);
});
describe('scoped enrollment collection', () => {
  it('scopes reads and saves by account/version and includes data sent before the voucher', async () => {
    await collectConversationEnrollments(db, 'account', 'conversation');
    expect(update).toHaveBeenCalledWith({
      data: { phone1: '51987000000', email: 'uno@gmail.com' },
    });
    expect(eq).toHaveBeenCalledWith('account_id', 'account');
    expect(eq).toHaveBeenCalledWith('conversation_id', 'conversation');
    expect(eq).toHaveBeenCalledWith('version', 2);
    expect(gte).not.toHaveBeenCalled();
    expect(syncPaidEnrollmentHandoff).toHaveBeenCalledWith(
      db,
      'account',
      'conversation',
      'draft',
      expect.objectContaining({ email: 'uno@gmail.com' })
    );
  });
  it('does not mix several simultaneous drafts', async () => {
    drafts = [{}, {}];
    await collectConversationEnrollments(db, 'account', 'conversation');
    expect(maybeSingle).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
  it('does nothing before a human validates payment', async () => {
    maybeSingle.mockResolvedValue({ data: { status: 'pending' }, error: null });
    await collectConversationEnrollments(db, 'account', 'conversation');
    expect(update).not.toHaveBeenCalled();
    expect(syncPaidEnrollmentHandoff).not.toHaveBeenCalled();
  });
  it('collects only the explicitly chosen draft and its own payment', async () => {
    drafts = [
      {
        id: 'first',
        review_id: 'review-first',
        version: 3,
        data: { course: 'NUTRICION Y DIETETICA' },
      },
      {
        id: 'second',
        review_id: 'review-second',
        version: 7,
        data: { course: 'AUXILIAR DE FARMACIA' },
      },
    ];
    await collectConversationEnrollments(
      db,
      'account',
      'conversation',
      'second'
    );
    expect(eq).toHaveBeenCalledWith('id', 'review-second');
    expect(eq).toHaveBeenCalledWith('id', 'second');
    expect(eq).toHaveBeenCalledWith('version', 7);
    expect(eq).not.toHaveBeenCalledWith('id', 'first');
    expect(update).toHaveBeenCalledTimes(1);
  });
  it('does not select a foreign draft and collects an explicitly chosen new intake', async () => {
    await collectConversationEnrollments(
      db,
      'account',
      'conversation',
      'foreign'
    );
    expect(update).not.toHaveBeenCalled();
    await collectConversationEnrollments(
      db,
      'account',
      'conversation',
      'draft'
    );
    expect(update).toHaveBeenCalledWith({
      data: { phone1: '51987000000', email: 'uno@gmail.com' },
    });
  });
  it('does not reset a draft when nothing new was extracted', async () => {
    limit.mockResolvedValue({ data: [], error: null });
    await collectConversationEnrollments(db, 'account', 'conversation');
    expect(update).not.toHaveBeenCalled();
  });
  it('propagates database failures instead of claiming success', async () => {
    limit.mockResolvedValue({ data: null, error: new Error('unavailable') });
    await expect(
      collectConversationEnrollments(db, 'account', 'conversation')
    ).rejects.toThrow('unavailable');
    expect(update).not.toHaveBeenCalled();
  });
});
