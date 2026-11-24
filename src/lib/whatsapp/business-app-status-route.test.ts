import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ role: vi.fn(), from: vi.fn(), decrypt: vi.fn(), check: vi.fn() }));
vi.mock('@/lib/auth/account', () => ({ requireRole: mocks.role, toErrorResponse: () => new Response('{}', { status: 403 }) }));
vi.mock('@/lib/automations/admin-client', () => ({ supabaseAdmin: () => ({ from: mocks.from }) }));
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: mocks.decrypt }));
vi.mock('@/lib/whatsapp/business-app-status', () => ({ checkBusinessAppStatus: mocks.check }));
import { GET } from '@/app/api/whatsapp/business-app-status/route';
let eq: ReturnType<typeof vi.fn>;
function configuration(result: unknown) {
  eq = vi.fn().mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue(result) });
  mocks.from.mockReturnValue({ select: vi.fn().mockReturnValue({ eq }) });
}
beforeEach(() => {
  vi.resetAllMocks(); mocks.role.mockResolvedValue({ accountId: 'current-account' });
  mocks.decrypt.mockReturnValue('secret-token');
  mocks.check.mockResolvedValue({ status: 'cloud_only', reason: 'confirmed' });
  configuration({ data: { phone_number_id: '123', access_token: 'encrypted-secret' }, error: null });
});
describe('owner-only Business app status', () => {
  it('rejects a caller before querying private configuration', async () => {
    mocks.role.mockRejectedValue(new Error('Forbidden'));
    expect((await GET()).status).toBe(403); expect(mocks.from).not.toHaveBeenCalled();
  });
  it('scopes the read to the authenticated account and never returns credentials', async () => {
    const response = await GET();
    expect(mocks.role).toHaveBeenCalledWith('owner');
    expect(eq).toHaveBeenCalledWith('account_id', 'current-account');
    expect(await response.json()).toEqual({ status: 'cloud_only', reason: 'confirmed' });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('distinguishes absent configuration without calling Meta', async () => {
    configuration({ data: null, error: null });
    expect(await (await GET()).json()).toEqual({ status: 'unconfigured' }); expect(mocks.check).not.toHaveBeenCalled();
  });
  it('does not interpret a database failure as absent configuration', async () => {
    configuration({ data: null, error: { message: 'private' } });
    const response = await GET(); expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('private'); expect(mocks.check).not.toHaveBeenCalled();
  });
  it('does not disclose a decryption failure', async () => {
    mocks.decrypt.mockImplementation(() => { throw new Error('private'); });
    const response = await GET(); expect(response.status).toBe(503); expect(await response.text()).not.toContain('private');
  });
});
