import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ key: vi.fn(), from: vi.fn(), calls: [] as Array<[string, unknown[]]>, rows: [] as unknown[] }));
vi.mock('@/lib/auth/api-context', () => ({ requireApiKey: h.key }));
import { GET } from './route';
const draft = (id: string, phone: string, status = 'collecting', purpose = 'enrollment') => ({
  id, review_id: id, created_at: '2026-10-23T12:00:00.000Z', status,
  data: { full_name: 'ESTUDIANTE', phone1: phone }, sales_adviser: 'INSTITUCION',
  registered_number: null, student_folder_url: null,
  review: { status: 'validated', payment_purpose: purpose, operation_reference: '000123' },
});
beforeEach(() => {
  vi.resetAllMocks(); h.calls = []; h.rows = [];
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'in', 'order', 'limit', 'or'])
    chain[method] = (...args: unknown[]) => { h.calls.push([method, args]); return chain; };
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: h.rows, error: null }).then(resolve);
  h.from.mockReturnValue(chain);
  h.key.mockResolvedValue({ accountId: 'account-a', supabase: { from: h.from } });
});
describe('paid enrollment sheet snapshot', () => {
  it('exports stable contact identity and existing human review metadata for the central bridge', async () => {
    h.rows = [{ ...draft('real','51912345678','registered'), updated_at: '2026-10-26T04:00:00Z',
      review: { status: 'validated', payment_purpose: 'enrollment', operation_reference: '000123',
        contact_id: 'contact-a', reviewed_by: 'reviewer-a', reviewed_at: '2026-10-25T15:00:00Z' } }];
    const result = await (await GET(new Request('https://crm.example/api/v1/enrollments/sheet'))).json();
    expect(result.data[0]).toMatchObject({ contact_id: 'contact-a', updated_at: '2026-10-26T04:00:00Z',
      reviewed_by: 'reviewer-a', reviewed_at: '2026-10-25T15:00:00Z' });
    expect(h.key).toHaveBeenCalledWith(expect.any(Request), 'enrollments:sync');
    expect(h.calls.some(([method]) => ['update','insert','delete'].includes(method))).toBe(false);
  });
  it('includes incomplete paid intakes while excluding tests and non-enrollment payments', async () => {
    h.rows = [draft('real','51912345678'), draft('test','+51 987 020 644'), draft('legacy','51911111111','registered','unclassified'), draft('unclassified','51922222222','collecting','unclassified'), draft('other','51933333333','collecting','other')];
    const response = await GET(new Request('https://crm.example/api/v1/enrollments/sheet'));
    const result = await response.json();
    expect(result.data.map((r: { id: string }) => r.id)).toEqual(['real','legacy']);
    expect(result.data[0].status).toBe('collecting');
    expect(h.key).toHaveBeenCalledWith(expect.any(Request),'enrollments:sync');
    expect(h.calls).toContainEqual(['eq',['account_id','account-a']]);
    expect(h.calls).toContainEqual(['eq',['review.account_id','account-a']]);
    expect(h.calls).toContainEqual(['eq',['review.status','validated']]);
    expect(h.calls.some(([method]) => ['update','insert','delete'].includes(method))).toBe(false);
  });
  it('uses the shared cursor so larger accounts are not limited to one page', async () => {
    h.rows = [draft('11111111-1111-4111-8111-111111111111','51912345678'),draft('22222222-2222-4222-8222-222222222222','51911111111')];
    const result = await (await GET(new Request('https://crm.example/api/v1/enrollments/sheet?limit=1'))).json();
    expect(result.data).toHaveLength(1);
    expect(result.meta.next_cursor).toEqual(expect.any(String));
    await GET(new Request(`https://crm.example/api/v1/enrollments/sheet?limit=1&cursor=${result.meta.next_cursor}`));
    expect(h.calls.some(([method]) => method === 'or')).toBe(true);
  });
  it('does not hide a paid intake because its unfinished evidence data is malformed', async () => {
    const row = draft('real','51912345678');
    row.data = { ...row.data, prices: 'PENDIENTE', identity_message_ids: ['bad-id'] } as typeof row.data;
    h.rows = [row];
    const result = await (await GET(new Request('https://crm.example/api/v1/enrollments/sheet'))).json();
    expect(result.data).toHaveLength(1);
    expect(result.data[0].data.full_name).toBe('ESTUDIANTE');
  });
});
