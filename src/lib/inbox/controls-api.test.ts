import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ permission: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/auth/permissions', () => ({
  requirePermission: mocks.permission,
}));
vi.mock('@/lib/auth/account', () => ({
  toErrorResponse: (e: { status?: number }) =>
    new Response(null, { status: e.status ?? 500 }),
}));
import { POST as tag } from '@/app/api/inbox/tags/route';
import { POST as labels } from '@/app/api/inbox/labels/route';
import { POST as transfer } from '@/app/api/inbox/transfer/route';
const id = '11111111-1111-4111-8111-111111111111';
const request = (body: unknown) =>
  new Request('https://example.test', {
    method: 'POST',
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.permission.mockResolvedValue({
    userId: id,
    accountId: id,
    supabase: { rpc: mocks.rpc },
  });
  mocks.rpc.mockResolvedValue({ data: id, error: null });
});
describe('controles de inbox en el servidor', () => {
  it('solo el catalogo autorizado puede crear etiquetas', async () => {
    mocks.permission.mockRejectedValue({ status: 403 });
    expect((await tag(request({}))).status).toBe(403);
    expect(mocks.permission).toHaveBeenCalledWith('tags', 'manage');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('manda destinatarios a la transaccion validada', async () => {
    expect(
      (
        await tag(
          request({
            name: 'ASHLEY',
            color: '#10b981',
            kind: 'access',
            audience: { users: [id], areas: [], roles: [] },
          })
        )
      ).status
    ).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith(
      'save_inbox_tag',
      expect.objectContaining({
        p_kind: 'access',
        p_audience: { users: [id], areas: [], roles: [] },
      })
    );
  });
  it('exige permiso de aplicar etiquetas', async () => {
    await labels(request({ conversations: [id], tag: id, remove: false }));
    expect(mocks.permission).toHaveBeenCalledWith('inbox', 'tag');
  });
  it('no declara aplicado un lote rechazado por RLS', async () => {
    mocks.rpc.mockResolvedValue({ error: { code: '42501' } });
    expect(
      (await labels(request({ conversations: [id], tag: id, remove: false })))
        .status
    ).toBe(403);
  });
  it('envia el alcance del historial sin ampliarlo', async () => {
    expect(
      (
        await transfer(
          request({ conversation: id, agent: id, full_history: false })
        )
      ).status
    ).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('transfer_inbox_conversation', {
      p_conversation: id,
      p_agent: id,
      p_full_history: false,
    });
  });
  it('rechaza alcance ausente antes de tocar datos', async () => {
    expect(
      (await transfer(request({ conversation: id, agent: id }))).status
    ).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
