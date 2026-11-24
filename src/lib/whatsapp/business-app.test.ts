import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkBusinessAppStatus } from './business-app-status';
import { parseBusinessAppEcho, recordBusinessAppEchoes } from './business-app-echo';
afterEach(() => vi.unstubAllGlobals());
describe('read-only coexistence', () => {
  it.each([true, false])('requires explicit provider evidence %s', async isOnApp => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ id: '123', platform_type: 'CLOUD_API', is_on_biz_app: isOnApp }));
    vi.stubGlobal('fetch', fetcher);
    expect((await checkBusinessAppStatus({ phoneNumberId: '123', accessToken: 'private' })).status).toBe(isOnApp ? 'coexistence' : 'cloud_only');
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'GET', cache: 'no-store', redirect: 'error' });
    expect(fetcher.mock.calls[0][0]).not.toContain('private');
  });
  it.each([{}, { id: '123', platform_type: 'CLOUD_API' }, { id: 'other', platform_type: 'CLOUD_API', is_on_biz_app: true }])('missing/mismatched evidence stays unknown', async body => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(body)));
    expect((await checkBusinessAppStatus({ phoneNumberId: '123', accessToken: 'private' })).status).toBe('unknown');
  });
  it('provider errors do not leak credentials or invent a disconnected state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('secret')));
    expect(await checkBusinessAppStatus({ phoneNumberId: '123', accessToken: 'secret' })).toMatchObject({ status: 'unknown', reason: 'provider_unavailable' });
  });
});
const phone = '51900000001';
const echo = { from: phone, to: '51900000002', id: 'fictional-id', timestamp: String(Math.floor(Date.now()/1000)), type: 'text', text: { body: 'Atención humana' } };
describe('business app outgoing echoes', () => {
  it('keeps outgoing direction and timestamp', () => {
    expect(parseBusinessAppEcho(echo, `+${phone}`)).toMatchObject({ recipient: echo.to, contentText: 'Atención humana', messageId: echo.id });
  });
  it.each([{ from: echo.to }, { to: phone }, { timestamp: '99999999999' }, { text: undefined }])('rejects malformed or customer-looking payload %j', patch => {
    expect(parseBusinessAppEcho({ ...echo, ...patch }, phone)).toBeNull();
  });
  it('preserves media captions without inventing a downloadable URL', () => {
    expect(parseBusinessAppEcho({ ...echo, type: 'image', image: { caption: 'Documento enviado' } }, phone))
      .toMatchObject({ contentType: 'image', contentText: 'Documento enviado' });
  });
  it('default-off does not write to the database', async () => {
    const rpc = vi.fn();
    await recordBusinessAppEchoes({ db: { rpc }, enabled: false, accountId: 'a', wabaId: 'w', phoneNumberId: 'p', businessPhone: phone, echoes: [echo] });
    expect(rpc).not.toHaveBeenCalled();
  });
  it('passes verified tenancy and outgoing content to the atomic recorder', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    await recordBusinessAppEchoes({ db: { rpc }, enabled: true, accountId: 'a', wabaId: 'w', phoneNumberId: 'p', businessPhone: phone, echoes: [echo] });
    expect(rpc).toHaveBeenCalledWith('record_whatsapp_business_app_echo', expect.objectContaining({ p_account_id: 'a', p_waba_id: 'w', p_recipient: echo.to }));
  });
});
