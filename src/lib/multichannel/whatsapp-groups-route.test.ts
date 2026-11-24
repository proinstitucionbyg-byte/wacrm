import { beforeEach, afterEach, it, expect, vi } from 'vitest';
const h = vi.hoisted(() => ({
  role: vi.fn(),
  from: vi.fn(),
  insert: vi.fn(),
  state: null as unknown,
  primary: true,
}));
vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: h.role,
  ForbiddenError: class extends Error {},
  toErrorResponse: () =>
    Response.json({ error: 'No autorizado' }, { status: 403 }),
}));
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({ from: h.from }),
}));
import { GET, POST } from '@/app/api/multichannel/whatsapp/groups/route';
const id = '11111111-1111-4111-8111-111111111111',
  account = '22222222-2222-4222-8222-222222222222';
const value = () => ({
  request_id: id,
  worker_id: id,
  line_key: 'WA-one',
  expected_phone: '51900000001',
  request: { kind: 'list', offset: 0, limit: 30, search: '' },
});
const request = (body: unknown) =>
  new Request('https://crm.example.test/api/multichannel/whatsapp/groups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('MULTICHANNEL_WHATSAPP_SESSION_BRIDGE_ENABLED', 'true');
  h.role.mockResolvedValue({ accountId: account, userId: id, role: 'owner' });
  h.primary = true;
  h.state = {
    seen_at: new Date().toISOString(),
    snapshot: [
      {
        lineKey: 'WA-one',
        label: 'Soporte',
        status: 'ready',
        active: true,
        linkedPhone: '51900000001',
        qr: null,
      },
    ],
  };
  h.from.mockImplementation((table: string) => {
    const q = {
      select: vi.fn(),
      eq: vi.fn(),
      insert: h.insert,
      maybeSingle: async () => ({
        data:
          table === 'multichannel_workers'
            ? { id }
            : table === 'multichannel_whatsapp_session_lines'
              ? h.primary ? {line_key:'WA-one',linked_phone:'51900000001'} : null
            : table === 'whatsapp_management_state'
              ? h.state
              : null,
        error: null,
      }),
      single: async () => ({ data: { id }, error: null }),
    };
    q.select.mockReturnValue(q);
    q.eq.mockReturnValue(q);
    h.insert.mockReturnValue(q);
    return q;
  });
});
afterEach(() => vi.unstubAllEnvs());
it('requires authentication before reading worker state or queuing commands', async () => {
  h.role.mockRejectedValue(Error('Denied'));
  expect((await POST(request(value()))).status).toBe(403);
  expect(h.from).not.toHaveBeenCalled();
});
it('does not grant group access automatically to account administrators', async () => {
  h.role.mockResolvedValue({ accountId: account, userId: id, role: 'admin' });
  expect((await POST(request(value()))).status).toBe(403);
  expect(h.insert).not.toHaveBeenCalled();
});
it('rejects a changed phone before inserting a group command', async () => {
  expect(
    (await POST(request({ ...value(), expected_phone: '51900000009' }))).status
  ).toBe(409);
  expect(h.insert).not.toHaveBeenCalled();
});
it('binds the accepted command to the server account, requester and exact selected line', async () => {
  expect((await POST(request(value()))).status).toBe(202);
  expect(h.insert).toHaveBeenCalledWith(
    expect.objectContaining({
      id,
      account_id: account,
      requested_by: id,
      worker_id: id,
      line_key: 'WA-one',
      expected_phone: '51900000001',
      operation: 'group_list',
      payload: value().request,
    })
  );
});
it('lists only confirmed ready numbers, excluding archives and stale or changed bindings', async () => {
  h.from.mockImplementation((table: string) => {
    const data =
      table === 'multichannel_whatsapp_session_lines'
        ? [
            { line_key: 'WA-one', linked_phone: '51900000001', worker_id: id },
            { line_key: 'WA-old', linked_phone: '51900000002', worker_id: id },
            {
              line_key: 'WA-changed',
              linked_phone: '51900000003',
              worker_id: id,
            },
          ]
        : [
            {
              worker_id: id,
              seen_at: new Date().toISOString(),
              snapshot: [
                {
                  lineKey: 'WA-one',
                  label: 'Soporte',
                  status: 'ready',
                  active: true,
                  linkedPhone: '51900000001',
                  qr: null,
                },
                {
                  lineKey: 'WA-old',
                  label: 'Historial anterior',
                  archived: true,
                  status: 'ready',
                  active: true,
                  linkedPhone: '51900000002',
                  qr: null,
                },
                {
                  lineKey: 'WA-changed',
                  label: 'Otro',
                  status: 'ready',
                  active: true,
                  linkedPhone: '51900000009',
                  qr: null,
                },
              ],
            },
          ];
    const q = {
      select: vi.fn(),
      eq: vi.fn(),
      order: vi.fn(),
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve(resolve({ data, error: null })),
    };
    q.select.mockReturnValue(q);
    q.eq.mockReturnValue(q);
    q.order.mockReturnValue(q);
    return q;
  });
  const response = await GET(
    new Request('https://crm.example.test/api/multichannel/whatsapp/groups')
  );
  expect(response.status).toBe(200);
  expect((await response.json()).lines).toEqual([
    {
      line_key: 'WA-one',
      linked_phone: '51900000001',
      worker_id: id,
      label: 'Soporte',
      can_manage: true,
    },
  ]);
});

it('refuses group actions on any line that the owner has not designated',async()=>{h.primary=false;expect((await POST(request(value()))).status).toBe(409);expect(h.insert).not.toHaveBeenCalled();});

it('media files are restricted to this account storage before queuing',async()=>{vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://storage.example.test');const media=(url:string)=>({...value(),request:{kind:'mutate',group_id:'123456789@g.us',change:{operation:'media',value:{kind:'audio',url,filename:'Original.ogg'}}}});expect((await POST(request(media('https://other.example.test/storage/v1/object/public/flow-media/account-'+account+'/a.ogg')))).status).toBe(400);expect((await POST(request(media('https://storage.example.test/storage/v1/object/public/flow-media/account-other/a.ogg')))).status).toBe(400);expect(h.insert).not.toHaveBeenCalled();expect((await POST(request(media('https://storage.example.test/storage/v1/object/public/flow-media/account-'+account+'/a.ogg')))).status).toBe(202);expect(h.insert).toHaveBeenCalledWith(expect.objectContaining({operation:'group_mutate',account_id:account}));});
