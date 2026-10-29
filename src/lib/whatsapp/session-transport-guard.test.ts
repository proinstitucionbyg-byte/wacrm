import { afterEach, describe, expect, it, vi } from 'vitest';
import { enqueueSessionManualText, enqueueSessionTextIfRequired, getSessionOriginLineForConversation, rejectUnsupportedSessionTransport } from './session-transport-guard';

function dbWith(result: { data: unknown; error: unknown }) {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
  return { from: vi.fn(() => query), query };
}

const originalFlag = process.env.MULTICHANNEL_WHATSAPP_SESSION_BRIDGE_ENABLED;
const originalSendFlag = process.env.MULTICHANNEL_WHATSAPP_SESSION_SEND_ENABLED;
afterEach(() => {
  if (originalFlag === undefined) delete process.env.MULTICHANNEL_WHATSAPP_SESSION_BRIDGE_ENABLED;
  else process.env.MULTICHANNEL_WHATSAPP_SESSION_BRIDGE_ENABLED = originalFlag;
  if (originalSendFlag === undefined) delete process.env.MULTICHANNEL_WHATSAPP_SESSION_SEND_ENABLED;
  else process.env.MULTICHANNEL_WHATSAPP_SESSION_SEND_ENABLED = originalSendFlag;
});

describe('enqueueSessionTextIfRequired', () => {
  function enqueueDb(sourceResult: { data: unknown; error: unknown }, queueResult = { data: { message_id: 'waweb-job:abc' }, error: null }, receiptResult = { data: { provider_message_id: 'inbound-provider-id' }, error: null }) {
    const query = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), not: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue(sourceResult),
    };
    const receiptQuery = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue(receiptResult),
    };
    return { from: vi.fn((table: string) => table === 'whatsapp_session_inbound_receipts' ? receiptQuery : query), query, receiptQuery, rpc: vi.fn().mockResolvedValue(queueResult) };
  }

  it('queues text on the source line with the latest inbound id and stable dedup key', async () => {
    process.env.MULTICHANNEL_WHATSAPP_SESSION_BRIDGE_ENABLED = 'true';
    process.env.MULTICHANNEL_WHATSAPP_SESSION_SEND_ENABLED = 'true';
    const db = enqueueDb({ data: { id: 'message-row-1', whatsapp_session_line_key: 'WA-SOPORTE' }, error: null }, undefined,
      { data: { provider_message_id: 'wamid-inbound' }, error: null });
    await expect(enqueueSessionTextIfRequired(db as never, { accountId: 'account', conversationId: 'conversation', text: 'Hola', idempotencyKey: 'automation:run:step' }))
      .resolves.toEqual({ whatsapp_message_id: 'waweb-job:abc' });
    expect(db.rpc).toHaveBeenCalledWith('enqueue_whatsapp_session_text', expect.objectContaining({
      p_line_key: 'WA-SOPORTE', p_inbound_provider_message_id: 'wamid-inbound', p_body: 'Hola',
    }));
  });

  it('refuses to fall back to Cloud while session sending is disabled', async () => {
    process.env.MULTICHANNEL_WHATSAPP_SESSION_BRIDGE_ENABLED = 'true';
    delete process.env.MULTICHANNEL_WHATSAPP_SESSION_SEND_ENABLED;
    const db = enqueueDb({ data: { id: 'message-row-1', whatsapp_session_line_key: 'WA-SOPORTE' }, error: null });
    await expect(enqueueSessionTextIfRequired(db as never, { accountId: 'account', conversationId: 'conversation', text: 'Hola' }))
      .rejects.toThrow('la salida aún no está habilitada');
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('uses Cloud only when the latest customer message itself has no session source', async () => {
    process.env.MULTICHANNEL_WHATSAPP_SESSION_BRIDGE_ENABLED = 'true';
    process.env.MULTICHANNEL_WHATSAPP_SESSION_SEND_ENABLED = 'true';
    const db = enqueueDb({ data: { id: 'message-row-1', whatsapp_session_line_key: null }, error: null });
    await expect(enqueueSessionTextIfRequired(db as never, { accountId: 'account', conversationId: 'conversation', text: 'Hola' }))
      .resolves.toBeNull();
    expect(db.rpc).not.toHaveBeenCalled();
  });
});

describe('getSessionOriginLineForConversation', () => {
  it('does not query the new column while the bridge is disabled', async () => {
    delete process.env.MULTICHANNEL_WHATSAPP_SESSION_BRIDGE_ENABLED;
    const db = dbWith({ data: null, error: null });
    await expect(getSessionOriginLineForConversation(db as never, 'conversation')).resolves.toBeNull();
    expect(db.from).not.toHaveBeenCalled();
  });

  it('returns the source line when the bridge is enabled', async () => {
    process.env.MULTICHANNEL_WHATSAPP_SESSION_BRIDGE_ENABLED = 'true';
    const db = dbWith({ data: { whatsapp_session_line_key: 'WA-SOPORTE' }, error: null });
    await expect(getSessionOriginLineForConversation(db as never, 'conversation')).resolves.toBe('WA-SOPORTE');
    expect(db.from).toHaveBeenCalledWith('messages');
    expect(db.query.eq).toHaveBeenCalledWith('conversation_id', 'conversation');
    expect(db.query.eq).toHaveBeenCalledWith('sender_type', 'customer');
  });

  it('fails closed if the source check cannot be completed', async () => {
    process.env.MULTICHANNEL_WHATSAPP_SESSION_BRIDGE_ENABLED = 'true';
    const db = dbWith({ data: null, error: new Error('database unavailable') });
    await expect(getSessionOriginLineForConversation(db as never, 'conversation'))
      .rejects.toThrow('No se pudo verificar con seguridad');
  });

  it('uses the latest customer message even when it came from another WhatsApp channel', async () => {
    process.env.MULTICHANNEL_WHATSAPP_SESSION_BRIDGE_ENABLED = 'true';
    const db = dbWith({ data: { whatsapp_session_line_key: null }, error: null });
    await expect(getSessionOriginLineForConversation(db as never, 'conversation')).resolves.toBeNull();
  });
});

describe('enqueueSessionManualText', () => {
  it('uses the selected conversation line and attributes the request to the authenticated sender', async () => {
    process.env.MULTICHANNEL_WHATSAPP_SESSION_SEND_ENABLED = 'true';
    const db = { rpc: vi.fn().mockResolvedValue({
      data: { message_id: 'waweb-job:job-1', message_row_id: 'row-1' }, error: null,
    }) };
    await expect(enqueueSessionManualText(db as never, {
      accountId: 'account', conversationId: 'conversation', senderId: 'agent', lineKey: 'WA-SOPORTE', text: 'Respuesta',
    })).resolves.toEqual({ messageId: 'row-1', whatsappMessageId: 'waweb-job:job-1' });
    expect(db.rpc).toHaveBeenCalledWith('enqueue_whatsapp_session_manual_text', expect.objectContaining({
      p_account_id: 'account', p_conversation_id: 'conversation', p_sender_id: 'agent', p_line_key: 'WA-SOPORTE', p_body: 'Respuesta',
    }));
  });

  it('refuses manual replies when the worker send feature is disabled', async () => {
    delete process.env.MULTICHANNEL_WHATSAPP_SESSION_SEND_ENABLED;
    const db = { rpc: vi.fn() };
    await expect(enqueueSessionManualText(db as never, {
      accountId: 'account', conversationId: 'conversation', senderId: 'agent', lineKey: 'WA-SOPORTE', text: 'Respuesta',
    })).rejects.toThrow('la salida aún no está habilitada');
    expect(db.rpc).not.toHaveBeenCalled();
  });
});

describe('rejectUnsupportedSessionTransport', () => {
  it('refuses template, media, or interactive sends on a session line instead of falling back to Cloud', async () => {
    process.env.MULTICHANNEL_WHATSAPP_SESSION_BRIDGE_ENABLED = 'true';
    process.env.MULTICHANNEL_WHATSAPP_SESSION_SEND_ENABLED = 'true';
    for (const capability of ['template', 'media', 'interactive'] as const) {
      const db = dbWith({ data: { whatsapp_session_line_key: 'WA-SOPORTE' }, error: null });
      await expect(rejectUnsupportedSessionTransport(db as never, 'conversation', capability))
        .rejects.toThrow(`todavía no admite mensajes ${capability}; no se enviará por Meta Cloud`);
    }
  });

  it('keeps the existing Cloud path for conversations whose newest inbound has no session source', async () => {
    process.env.MULTICHANNEL_WHATSAPP_SESSION_BRIDGE_ENABLED = 'true';
    const db = dbWith({ data: { whatsapp_session_line_key: null }, error: null });
    await expect(rejectUnsupportedSessionTransport(db as never, 'cloud-conversation', 'interactive')).resolves.toBeUndefined();
  });
});
