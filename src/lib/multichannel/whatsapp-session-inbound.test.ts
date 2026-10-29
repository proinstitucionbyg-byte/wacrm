import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { sessionContentType, sessionSenderPhone } from './whatsapp-session-protocol';

const mocks = vi.hoisted(() => ({ factory: vi.fn(), from: vi.fn(), rpc: vi.fn(), dispatch: vi.fn() }));
vi.mock('@/lib/automations/admin-client', () => ({ supabaseAdmin: () => mocks.factory() }));
vi.mock('@/lib/whatsapp/inbound-dispatch', () => ({ dispatchInboundThroughCrm: mocks.dispatch }));
import { POST } from '@/app/api/multichannel/whatsapp/inbound/route';

const token = `wcm_${'a'.repeat(64)}`;
const payload = {
  line_key: 'WA-line-1', linked_phone: '51911111111', provider_message_id: 'true_A1B2C3',
  chat_id: '51922222222@c.us', occurred_at: '2026-10-29T08:00:00-05:00', type: 'chat', text: 'Hola',
};
const request = (body: unknown, authorization = `Bearer ${token}`) => new Request('https://crm.example/api/multichannel/whatsapp/inbound', {
  method: 'POST', headers: { Authorization: authorization, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('MULTICHANNEL_WHATSAPP_SESSION_BRIDGE_ENABLED', 'true');
  const rows: Record<string, { data: unknown; error: null }> = {
    multichannel_workers: { data: { id: 'trusted-worker', account_id: 'account-1' }, error: null },
    whatsapp_session_inbound_receipts: { data: { message_row_id: 'message-row', contact_created: true, is_first_inbound: true, previous_inbound_at: null }, error: null },
    messages: { data: { message_id: 'waweb:WA-line-1:true_A1B2C3', conversation_id: 'conversation-1', content_text: 'Hola', created_at: payload.occurred_at }, error: null },
    conversations: { data: { id: 'conversation-1', contact_id: 'contact-1', user_id: 'owner-1', automation_enabled: true, ai_enabled: true, last_human_message_at: null }, error: null },
  };
  mocks.from.mockImplementation((table: string) => {
    const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() };
    (query as typeof query & { table: string }).table = table;
    query.select.mockReturnValue(query); query.eq.mockReturnValue(query);
    query.maybeSingle.mockImplementation(() => Promise.resolve(rows[table]));
    return query;
  });
  mocks.factory.mockReturnValue({ from: mocks.from, rpc: mocks.rpc });
  mocks.rpc.mockResolvedValue({ data: 'recorded', error: null });
  mocks.dispatch.mockResolvedValue(undefined);
});

describe('entrada de WhatsApp Web', () => {
  it('is disabled by default and does not access the database', async () => {
    vi.stubEnv('MULTICHANNEL_WHATSAPP_SESSION_BRIDGE_ENABLED', '');
    expect((await POST(request(payload))).status).toBe(503);
    expect(mocks.factory).not.toHaveBeenCalled();
  });

  it('accepts only a registered worker and uses its server-derived identity', async () => {
    const response = await POST(request({ ...payload, account_id: 'forged' }));
    // Extra account fields are rejected rather than trusted.
    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();

    const accepted = await POST(request(payload));
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual({ result: 'recorded' });
    expect(mocks.from).toHaveBeenCalledWith('multichannel_workers');
    expect(mocks.from.mock.results[0]?.value.eq).toHaveBeenCalledWith(
      'token_hash', createHash('sha256').update(token).digest('hex'),
    );
    expect(mocks.rpc).toHaveBeenCalledWith('record_whatsapp_session_inbound', expect.objectContaining({
      p_worker_id: 'trusted-worker', p_line_key: payload.line_key, p_linked_phone: payload.linked_phone,
      p_sender_phone: '51922222222', p_content_type: 'text', p_content_text: 'Hola',
    }));
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain(token);
  });

  it('refuses opaque LID identities instead of inventing a phone', async () => {
    const response = await POST(request({ ...payload, chat_id: '123456789@lid' }));
    expect(response.status).toBe(422);
    expect(mocks.factory).not.toHaveBeenCalled();
  });

  it('keeps idempotent duplicate receipts and paused lines explicit', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: 'duplicate', error: null });
    expect(await (await POST(request(payload))).json()).toEqual({ result: 'duplicate' });
    mocks.rpc.mockResolvedValueOnce({ data: 'paused_or_unbound', error: null });
    expect((await POST(request(payload))).status).toBe(423);
  });

  it('does not expose body or credentials when the database fails', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'private failure' } });
    const response = await POST(request(payload));
    expect(response.status).toBe(503);
    const message = await response.text();
    expect(message).not.toContain(token);
    expect(message).not.toContain(payload.text);
  });

  it('normalizes only known WhatsApp content types', () => {
    expect(sessionSenderPhone('51922222222@c.us')).toBe('51922222222');
    expect(sessionSenderPhone('123456789@lid')).toBeNull();
    expect(sessionContentType('sticker')).toBe('image');
    expect(sessionContentType('ptt')).toBe('audio');
    expect(sessionContentType('unknown')).toBe('text');
  });
});
