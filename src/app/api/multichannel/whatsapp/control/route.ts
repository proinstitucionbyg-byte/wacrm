import { createHash, randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { whatsappSessionLineKeySchema } from '@/lib/multichannel/whatsapp-session-protocol';
import { z } from 'zod';

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('register_worker'), name: z.string().trim().min(1).max(80) }).strict(),
  z.object({ action: z.literal('register_line'), line_key: whatsappSessionLineKeySchema,
    linked_phone: z.string().regex(/^\d{7,15}$/), worker_id: z.string().uuid() }).strict(),
  z.object({ action: z.literal('pause_line'), line_key: whatsappSessionLineKeySchema, value: z.boolean() }).strict(),
]);

function disabled() {
  return process.env.MULTICHANNEL_WHATSAPP_SESSION_BRIDGE_ENABLED !== 'true';
}

export async function GET() {
  try {
    const ctx = await requireRole('owner');
    if (disabled()) return NextResponse.json({ error: 'Puente de WhatsApp Web todavía no habilitado.' }, { status: 503 });
    const db = supabaseAdmin();
    const [lines, workers] = await Promise.all([
      db.from('multichannel_whatsapp_session_lines')
        .select('line_key,linked_phone,worker_id,paused,updated_at').eq('account_id', ctx.accountId).order('line_key').limit(50),
      db.from('multichannel_workers').select('id,name,enabled,last_seen_at')
        .eq('account_id', ctx.accountId).order('created_at').limit(50),
    ]);
    if (lines.error) throw lines.error;
    if (workers.error) throw workers.error;
    return NextResponse.json({ lines: lines.data, workers: workers.data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return toErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('owner');
    if (disabled()) return NextResponse.json({ error: 'Puente de WhatsApp Web todavía no habilitado.' }, { status: 503 });
    const input = actionSchema.safeParse(await request.json().catch(() => null));
    if (!input.success) return NextResponse.json({ error: 'Configuración inválida.' }, { status: 400 });
    const db = supabaseAdmin();

    if (input.data.action === 'register_worker') {
      const token = `wcm_${randomBytes(32).toString('hex')}`;
      const inserted = await db.from('multichannel_workers').insert({
        account_id: ctx.accountId, name: input.data.name,
        token_hash: createHash('sha256').update(token).digest('hex'),
      }).select('id,name').single();
      if (inserted.error) throw inserted.error;
      return NextResponse.json({ worker: inserted.data, token }, {
        status: 201, headers: { 'Cache-Control': 'no-store' },
      });
    }

    if (input.data.action === 'register_line') {
      const worker = await db.from('multichannel_workers').select('id')
        .eq('id', input.data.worker_id).eq('account_id', ctx.accountId).eq('enabled', true).maybeSingle();
      if (worker.error) throw worker.error;
      if (!worker.data) return NextResponse.json({ error: 'Ejecutor no disponible en esta cuenta.' }, { status: 404 });
      const inserted = await db.from('multichannel_whatsapp_session_lines').insert({
        account_id: ctx.accountId, line_key: input.data.line_key,
        linked_phone: input.data.linked_phone, worker_id: worker.data.id, paused: true,
      }).select('line_key,linked_phone,worker_id,paused').single();
      if (inserted.error?.code === '23505') return NextResponse.json({ error: 'La línea ya está registrada.' }, { status: 409 });
      if (inserted.error) throw inserted.error;
      return NextResponse.json({ line: inserted.data }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
    }

    const changed = await db.from('multichannel_whatsapp_session_lines').update({
      paused: input.data.value, updated_at: new Date().toISOString(),
    }).eq('account_id', ctx.accountId).eq('line_key', input.data.line_key)
      .select('line_key,paused').maybeSingle();
    if (changed.error) throw changed.error;
    return changed.data
      ? NextResponse.json({ line: changed.data }, { headers: { 'Cache-Control': 'no-store' } })
      : NextResponse.json({ error: 'Línea no encontrada.' }, { status: 404 });
  } catch (error) { return toErrorResponse(error); }
}
