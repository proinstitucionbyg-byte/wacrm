import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
const mocks = vi.hoisted(() => ({ role: vi.fn(), bucket: vi.fn(), upload: vi.fn() }));
vi.mock('@/lib/auth/account', () => ({ requireRole: mocks.role, toErrorResponse: (e: {status?: number}) => NextResponse.json({error: 'denied'}, {status: e.status ?? 500}) }));
import { POST } from '@/app/api/team-chat/[id]/attachments/route';
const thread = '11111111-1111-4111-8111-111111111111';
const account = '22222222-2222-4222-8222-222222222222';
function request(file?: File) { const form = new FormData(); if (file) form.set('file', file); return new Request('http://localhost', {method:'POST', body:form}); }
const context = (id = thread) => ({params:Promise.resolve({id})});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.role.mockResolvedValue({accountId:account, supabase:{storage:{from:mocks.bucket}}});
  mocks.bucket.mockReturnValue({upload:mocks.upload});
  mocks.upload.mockResolvedValue({error:null});
});
describe('archivos privados del chat interno individual y grupal', () => {
  it('requires an authenticated member', async () => { mocks.role.mockRejectedValue({status:401}); expect((await POST(request(),context())).status).toBe(401); expect(mocks.upload).not.toHaveBeenCalled(); });
  it('rejects invalid chat IDs', async () => { expect((await POST(request(),context('invalid'))).status).toBe(400); expect(mocks.upload).not.toHaveBeenCalled(); });
  it.each([undefined, new File([''], 'vacio.txt', {type:'text/plain'}), new File(['code'], 'app.exe', {type:'application/octet-stream'}), new File([new Uint8Array(16*1024*1024+1)], 'grande.pdf', {type:'application/pdf'})])('rejects missing, empty, unsupported and oversized files', async file => { expect((await POST(request(file),context())).status).toBe(400); expect(mocks.upload).not.toHaveBeenCalled(); });
  it.each(['application/pdf','image/png','text/plain'])('stages %s in the private account/thread bucket without sending a message', async type => {
    const response = await POST(request(new File(['contenido'], 'PRUEBA', {type})),context());
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.attachment_path).toMatch(new RegExp(`^account-${account}/${thread}/[0-9a-f-]{36}$`));
    expect(result.attachment_name).toBe('PRUEBA');
    expect(mocks.bucket).toHaveBeenCalledWith('team-chat-media');
    expect(mocks.upload).toHaveBeenCalledWith(result.attachment_path, expect.any(File), {contentType:type,upsert:false});
    expect(result.attachment_url).toBeUndefined();
  });
  it('denies staging when storage membership/archived policy denies access', async () => { mocks.upload.mockResolvedValue({error:{message:'denied'}}); expect((await POST(request(new File(['x'],'x.pdf',{type:'application/pdf'})),context())).status).toBe(403); });
});
