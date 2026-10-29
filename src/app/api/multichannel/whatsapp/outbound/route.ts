import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { resumeDeliveredMessage } from '@/lib/automations/engine';
import { whatsappSessionOutboundWorkerSchema } from '@/lib/multichannel/whatsapp-session-outbound-protocol';

export const runtime = 'nodejs';
const respond = (body: unknown, status = 200) => NextResponse.json(body, {
  status, headers: { 'Cache-Control': 'no-store' },
});

async function readBoundedJson(request: Request): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '') ||
      Number(request.headers.get('content-length') ?? 0) > 16_000) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 16_000) { await reader.cancel(); return null; }
      chunks.push(part.value);
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  } catch { return null; }
}

export async function POST(request: Request) {
  if (process.env.MULTICHANNEL_WHATSAPP_SESSION_SEND_ENABLED !== 'true') {
    return respond({ error: 'El envío por sesión WhatsApp todavía no está habilitado.' }, 503);
  }
  const authorization = request.headers.get('authorization') ?? '';
  if (!/^Bearer wcm_[a-f0-9]{64}$/.test(authorization)) return respond({ error: 'Ejecutor no autorizado.' }, 401);
  const parsed = whatsappSessionOutboundWorkerSchema.safeParse(await readBoundedJson(request));
  if (!parsed.success) return respond({ error: 'Acción de salida inválida.' }, 400);

  try {
    const db = supabaseAdmin();
    const tokenHash = createHash('sha256').update(authorization.slice(7)).digest('hex');
    const worker = await db.from('multichannel_workers').select('id,account_id')
      .eq('token_hash', tokenHash).eq('enabled', true).maybeSingle();
    if (worker.error) return respond({ error: 'Cola WhatsApp no disponible.' }, 503);
    if (!worker.data) return respond({ error: 'Ejecutor revocado o no registrado.' }, 401);

    const action = parsed.data;
    const { data, error } = await db.rpc('whatsapp_session_outbound_step', {
      p_worker_id: worker.data.id,
      p_line_key: action.line_key,
      p_action: action.action,
      p_job_id: 'job_id' in action ? action.job_id : null,
      p_claim_token: 'claim_token' in action ? action.claim_token : null,
      p_state: action.action === 'record' ? action.state : null,
      p_provider_message_id: action.action === 'record' ? action.provider_message_id ?? null : null,
    });
    if (error?.code === '42501') return respond({ error: 'Línea no autorizada o pausa activa.' }, 403);
    if (error) return respond({ error: 'Cola WhatsApp no disponible; no se confirmó el envío.' }, 503);

    if (action.action === 'claim') {
      if (!data) return respond({ job: null });
      return respond({ job: {
        id: data.id,
        key: `wa-session:${data.id}`,
        accountId: data.account_id,
        lineKey: data.line_key,
        chatId: data.chat_id,
        inboundId: data.inbound_provider_message_id,
        body: data.body,
        claimToken: data.claim_token,
      } });
    }

    if (action.action === 'authorize') {
      if (!data?.allowed || data.job_id !== action.job_id || data.line_key !== action.line_key ||
          data.chat_id !== action.chat_id || data.inbound_provider_message_id !== action.inbound_provider_message_id ||
          data.claim_token !== action.claim_token ||
          createHash('sha256').update(data.body ?? '').digest('hex') !== action.body_hash) {
        return respond({ permit: { allowed: false } });
      }
      const expiresAt = Date.parse(data.expires_at);
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() || expiresAt > Date.now() + 30_000) {
        return respond({ permit: { allowed: false } });
      }
      return respond({ permit: {
        allowed: true, paused: false, permissionConfirmed: true,
        accountId: data.account_id, lineKey: data.line_key, sessionPhone: data.session_phone,
        inboundId: data.inbound_provider_message_id, chatId: data.chat_id,
        bodyHash: action.body_hash, expiresAt,
      } });
    }

    if (data?.recorded && ['delivered','read'].includes(data.status) && data.message_id) {
      const job = await db.from('whatsapp_session_outbound_jobs').select('conversation_id')
        .eq('id', action.job_id).eq('account_id', worker.data.account_id).maybeSingle();
      // Delivery confirmation is a convenience; the durable job/message update above is authoritative.
      if (!job.error && job.data?.conversation_id) {
        void resumeDeliveredMessage(data.message_id, job.data.conversation_id, worker.data.account_id);
      }
    }
    return respond({ receipt: data ?? null });
  } catch {
    // Never log credentials, message content, phone numbers or provider payloads.
    return respond({ error: 'Cola WhatsApp no disponible; no se confirmó el resultado.' }, 503);
  }
}
