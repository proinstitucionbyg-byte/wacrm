import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { smsWorkerActionSchema } from '@/lib/multichannel/sms-protocol';

export const runtime = 'nodejs';
const reply = (body: unknown, status = 200) => NextResponse.json(body, {
  status, headers: { 'Cache-Control': 'no-store' },
});

export async function POST(request: Request) {
  if (process.env.MULTICHANNEL_SMS_ENABLED !== 'true') return reply({ error: 'Transporte SMS no habilitado.' }, 503);
  const authorization = request.headers.get('authorization') ?? '';
  if (!/^Bearer wcm_[a-f0-9]{64}$/.test(authorization)) return reply({ error: 'Credencial de laptop inválida.' }, 401);
  const input = smsWorkerActionSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return reply({ error: 'Acción SMS inválida.' }, 400);
  try {
    const db = supabaseAdmin();
    const hash = createHash('sha256').update(authorization.slice(7)).digest('hex');
    const worker = await db.from('multichannel_workers').select('id')
      .eq('token_hash', hash).eq('enabled', true).maybeSingle();
    if (worker.error) return reply({ error: 'Cola SMS no disponible.' }, 503);
    if (!worker.data) return reply({ error: 'Laptop no autorizada.' }, 401);
    const a = input.data;
    const { data, error } = await db.rpc('multichannel_sms_step', {
      p_worker_id: worker.data.id, p_action: a.action, p_line_key: a.line_key, p_device_key: a.device_key,
      p_job_id: 'job_id' in a ? a.job_id : null, p_claim_token: 'claim_token' in a ? a.claim_token : null,
      p_state: a.action === 'record' ? a.state : null,
      p_provider_id: a.action === 'record' ? a.provider_id : null,
      p_ready: a.action === 'heartbeat' ? a.ready : null,
    });
    if (error?.code === '42501') return reply({ error: 'Línea o laptop no autorizada.' }, 403);
    if (error) return reply({ error: 'Cola SMS no disponible; no se confirmó el resultado.' }, 503);
    const key = a.action === 'identity' ? 'identity' : a.action === 'heartbeat' ? 'heartbeat'
      : a.action === 'permit' ? 'permit' : a.action === 'record' ? 'receipt' : 'job';
    return reply({ mode: 'sms_live', [key]: data });
  } catch { return reply({ error: 'Cola SMS no disponible; no se confirmó el resultado.' }, 503); }
}
