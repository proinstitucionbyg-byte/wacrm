import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { dispatchInboundThroughCrm } from '@/lib/whatsapp/inbound-dispatch';
import { sessionContentType, sessionSenderPhone, whatsappSessionInboundSchema } from '@/lib/multichannel/whatsapp-session-protocol';

export const runtime = 'nodejs';

async function readBoundedJson(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 70_000) { await reader.cancel(); return null; }
      chunks.push(part.value);
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  } catch { return null; }
}

export async function POST(request: Request) {
  if (process.env.MULTICHANNEL_WHATSAPP_SESSION_BRIDGE_ENABLED !== 'true') {
    return NextResponse.json({ error: 'Ingreso central de WhatsApp Web todavía no habilitado.' }, { status: 503 });
  }
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '') ||
      Number(request.headers.get('content-length') ?? 0) > 70_000) {
    return NextResponse.json({ error: 'Solicitud inválida.' }, { status: 400 });
  }
  const authorization = request.headers.get('authorization') ?? '';
  if (!/^Bearer wcm_[a-f0-9]{64}$/.test(authorization)) {
    return NextResponse.json({ error: 'Ejecutor no autorizado.' }, { status: 401 });
  }
  const parsed = whatsappSessionInboundSchema.safeParse(await readBoundedJson(request));
  if (!parsed.success) return NextResponse.json({ error: 'Evento entrante inválido.' }, { status: 400 });
  const senderPhone = sessionSenderPhone(parsed.data.chat_id, parsed.data.sender_phone);
  if (!senderPhone) {
    // A LID is an opaque WhatsApp identity, not a phone number. Preserve it
    // in the local session until a verified contact-resolution path exists.
    return NextResponse.json({ error: 'Este chat requiere resolver el contacto antes de sincronizarlo.' }, { status: 422 });
  }

  try {
    const db = supabaseAdmin();
    const tokenHash = createHash('sha256').update(authorization.slice(7)).digest('hex');
    const worker = await db.from('multichannel_workers').select('id,account_id')
      .eq('token_hash', tokenHash).eq('enabled', true).maybeSingle();
    if (worker.error) throw worker.error;
    if (!worker.data) return NextResponse.json({ error: 'Ejecutor revocado o no registrado.' }, { status: 401 });

    const result = await db.rpc('record_whatsapp_session_inbound', {
      p_worker_id: worker.data.id,
      p_line_key: parsed.data.line_key,
      p_linked_phone: parsed.data.linked_phone,
      p_provider_message_id: parsed.data.provider_message_id,
      p_sender_phone: senderPhone,
      p_occurred_at: parsed.data.occurred_at,
      p_content_type: sessionContentType(parsed.data.type),
      p_content_text: parsed.data.text,
    });
    if (result.error) throw result.error;
    if (result.data === 'paused_or_unbound') {
      return NextResponse.json({ error: 'Línea sin registrar o pausada.' }, { status: 423 });
    }
    if (!['recorded', 'duplicate'].includes(result.data)) throw new Error('Unexpected inbound result');

    // Only plain text is sent to the shared CRM dispatcher for now. Other
    // media remain visible in the Inbox as placeholders until their CRM
    // storage and WhatsApp Web transport are implemented.
    if (parsed.data.type === 'chat' && parsed.data.text?.trim()) {
      const receipt = await db.from('whatsapp_session_inbound_receipts')
        .select('message_row_id,contact_created,is_first_inbound,previous_inbound_at')
        .eq('account_id', worker.data.account_id).eq('line_key', parsed.data.line_key)
        .eq('provider_message_id', parsed.data.provider_message_id).maybeSingle();
      if (receipt.error || !receipt.data) throw receipt.error ?? new Error('Inbound receipt unavailable');

      const message = await db.from('messages').select('message_id,conversation_id,content_text,created_at')
        .eq('id', receipt.data.message_row_id).eq('sender_type', 'customer').maybeSingle();
      if (message.error || !message.data) throw message.error ?? new Error('Inbound message unavailable');
      const conversation = await db.from('conversations')
        .select('id,contact_id,user_id,automation_enabled,ai_enabled,last_human_message_at')
        .eq('id', message.data.conversation_id).eq('account_id', worker.data.account_id).maybeSingle();
      if (conversation.error || !conversation.data) throw conversation.error ?? new Error('Conversation unavailable');

      await dispatchInboundThroughCrm({
        db,
        channel: 'session',
        accountId: worker.data.account_id,
        userId: conversation.data.user_id,
        contactId: conversation.data.contact_id,
        conversationId: conversation.data.id,
        messageId: message.data.message_id,
        contentText: message.data.content_text,
        isFirstInboundMessage: receipt.data.is_first_inbound,
        previousInboundAt: receipt.data.previous_inbound_at ?? undefined,
        inboundAt: message.data.created_at,
        contactCreated: receipt.data.contact_created,
        hasConfirmedAdOrigin: false,
        conversation: conversation.data,
      });
    }
    return NextResponse.json({ result: result.data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    // Never log event text, linked numbers or worker credentials.
    return NextResponse.json({ error: 'No se confirmó la sincronización. El mensaje permanece en la sesión local.' }, { status: 503 });
  }
}
