import { createHash, randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { smsOwnerActionSchema } from '@/lib/multichannel/sms-protocol';

export const runtime = 'nodejs';
const reply = (body: unknown, status = 200) => NextResponse.json(body, {
  status, headers: { 'Cache-Control': 'no-store' },
});
const unavailable = () => reply({ error: 'No se pudo confirmar la operación SMS. Consulta su estado antes de repetir.' }, 503);

export async function GET() {
  let ctx;
  try { ctx = await requireRole('owner'); } catch (error) { return toErrorResponse(error); }
  if (process.env.MULTICHANNEL_SMS_ENABLED !== 'true') return reply({ error: 'Transporte SMS no habilitado.' }, 503);
  try {
    const db = supabaseAdmin();
    const [jobs, lines, permissions] = await Promise.all([
      db.from('multichannel_jobs').select('id,line_key,contact_id,purpose,status,provider_state,provider_id,run_at,expires_at,next_check_at,attempts')
        .eq('account_id', ctx.accountId).eq('mode', 'sms_live').order('created_at', { ascending: false }).limit(100),
      db.from('multichannel_lines').select('line_key,device_key,paused,available,ready_at,interval_seconds,daily_limit')
        .eq('account_id', ctx.accountId).like('line_key', 'SMS-%').order('line_key').limit(100),
      db.from('multichannel_sms_authorizations').select('contact_id,purpose,granted,expires_at,reviewed_by,reviewed_at')
        .eq('account_id', ctx.accountId).order('reviewed_at', { ascending: false }).limit(100),
    ]);
    if (jobs.error || lines.error || permissions.error) return unavailable();
    return reply({ mode: 'sms_live', jobs: jobs.data, lines: lines.data, permissions: permissions.data });
  } catch { return unavailable(); }
}

export async function POST(request: Request) {
  let ctx;
  try { ctx = await requireRole('owner'); } catch (error) { return toErrorResponse(error); }
  if (process.env.MULTICHANNEL_SMS_ENABLED !== 'true') return reply({ error: 'Transporte SMS no habilitado.' }, 503);
  const input = smsOwnerActionSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return reply({ error: 'Acción SMS inválida. Cobranza aún requiere conciliación de saldos.' }, 400);
  try {
    const { action, ...payload } = input.data;
    const token = action === 'register_worker' ? `wcm_${randomBytes(32).toString('hex')}` : null;
    const { data, error } = await supabaseAdmin().rpc('multichannel_sms_control', {
      p_account_id: ctx.accountId, p_actor_id: ctx.userId, p_action: action,
      p_payload: token ? { ...payload, token_hash: createHash('sha256').update(token).digest('hex') } : payload,
    });
    if (error?.code === '23505') return reply({ error: 'Ya está registrado; no se ha duplicado.' }, 409);
    if (error?.code === '42501') return reply({ error: 'Operación no autorizada.' }, 403);
    if (error) return unavailable(); // Never log DB details, destinations, notes or credentials.
    if (data === null) return reply({ error: 'Registro no encontrado en esta cuenta.' }, 404);
    return reply(token ? { mode: 'sms_live', worker: data, token } : { mode: 'sms_live', result: data },
      action === 'register_worker' || action === 'enqueue' ? 201 : 200);
  } catch { return unavailable(); }
}
