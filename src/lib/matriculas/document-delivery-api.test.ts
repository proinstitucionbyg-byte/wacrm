import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  key: vi.fn(),
  from: vi.fn(),
  single: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  upload: vi.fn(),
  send: vi.fn(),
}));
vi.mock('@/lib/auth/api-context', () => ({ requireApiKey: mocks.key }));
vi.mock('@/lib/whatsapp/meta-api', () => ({ uploadMedia: mocks.upload }));
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: () => 'test-token' }));
vi.mock('@/lib/automations/meta-send', () => ({ engineSendMedia: mocks.send }));
import { POST } from '@/app/api/v1/enrollments/[id]/documents/[kind]/route';
const id = '11111111-1111-4111-8111-111111111111';
const pdf = '%PDF-1.4\nTEST\n%%EOF';
const context = (kind = 'BOLETA') => ({
  params: Promise.resolve({ id, kind }),
});
const request = (content = pdf, lease = 'lease') =>
  new Request('https://crm.test', {
    method: 'POST',
    headers: { 'content-type': 'application/pdf', 'x-enrollment-lease': lease },
    body: content,
  });
beforeEach(() => {
  vi.resetAllMocks();
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: mocks.single,
    insert: mocks.insert,
    update: mocks.update,
  };
  mocks.from.mockReturnValue(chain);
  mocks.update.mockReturnValue(chain);
  mocks.insert.mockResolvedValue({ error: null });
  mocks.key.mockResolvedValue({
    accountId: 'account',
    supabase: { from: mocks.from },
  });
  mocks.single
    .mockResolvedValueOnce({
      data: {
        id,
        status: 'registered',
        lease_token: 'lease',
        conversation_id: 'conv',
        review_id: 'review',
        data: { full_name: 'LUIS TEST', document_number: '12345678' },
      },
    })
    .mockResolvedValueOnce({ data: { status: 'validated' } })
    .mockResolvedValueOnce({ data: null })
    .mockResolvedValueOnce({
      data: {
        id: 'conv',
        contact: { channel: 'whatsapp' },
        contact_id: 'contact',
        user_id: 'owner',
      },
    })
    .mockResolvedValueOnce({
      data: { phone_number_id: 'number', access_token: 'encrypted' },
    });
  mocks.upload.mockResolvedValue({ mediaId: '1234' });
  mocks.send.mockResolvedValue({ whatsapp_message_id: 'wamid' });
});
describe('PDF delivery bridge', () => {
  it('requires the limited integration scope', async () => {
    expect((await POST(request(), context())).status).toBe(200);
    expect(mocks.key).toHaveBeenCalledWith(
      expect.any(Request),
      'enrollments:sync'
    );
  });
  it('rejects any unsupported document kind', async () => {
    expect((await POST(request(), context('DNI'))).status).toBe(400);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it('rejects another lease before upload', async () => {
    expect((await POST(request(pdf, 'other'), context())).status).toBe(403);
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it('never sends for an unvalidated payment', async () => {
    mocks.single
      .mockReset()
      .mockResolvedValueOnce({
        data: { status: 'registered', lease_token: 'lease' },
      })
      .mockResolvedValueOnce({ data: { status: 'pending' } });
    expect((await POST(request(), context())).status).toBe(403);
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it('rejects disguised non PDF content', async () => {
    expect((await POST(request('<html>'), context())).status).toBe(400);
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it('sends the uploaded document through Meta without a public Drive link', async () => {
    await POST(request(), context('FICHA'));
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaUrl: '1234',
        filename: 'FICHA-LUIS TEST-12345678.pdf',
      })
    );
  });
  it('freezes an uncertain send rather than automatically duplicating it', async () => {
    mocks.send.mockRejectedValue(new Error('TIMEOUT'));
    expect((await POST(request(), context())).status).toBe(502);
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'review' })
    );
  });
  it('does not send after a concurrent reservation wins', async () => {
    mocks.insert.mockResolvedValue({ error: { code: '23505' } });
    expect((await POST(request(), context())).status).toBe(409);
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
