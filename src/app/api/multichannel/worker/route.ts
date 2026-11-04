import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { workerActionSchema } from '@/lib/multichannel/protocol';

export async function POST(request: Request) {
  if (process.env.MULTICHANNEL_SIMULATION_ENABLED !== 'true') {
    return NextResponse.json({ error: 'Simulación multicanal todavía no habilitada.' }, { status: 503 });
  }
  const authorization = request.headers.get('authorization') ?? '';
  if (!/^Bearer wcm_[a-f0-9]{64}$/.test(authorization)) {
    return NextResponse.json({ error: 'Credencial de laptop inválida.' }, { status: 401 });
  }
  const input = workerActionSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: 'Acción inválida.' }, { status: 400 });
  try {
    const db = supabaseAdmin();
    const hash = createHash('sha256').update(authorization.slice(7)).digest('hex');
    const worker = await db.from('multichannel_workers').select('id')
      .eq('token_hash', hash).eq('enabled', true).maybeSingle();
    if (worker.error) throw worker.error;
    if (!worker.data) return NextResponse.json({ error: 'Laptop no autorizada.' }, { status: 401 });
    const action = input.data;
    const result = await db.rpc('multichannel_worker_step', {
      p_worker_id: worker.data.id, p_action: action.action,
      p_job_id: action.action === 'claim' ? null : action.job_id,
      p_claim_token: action.action === 'claim' ? null : action.claim_token,
    });
    if (result.error) throw result.error;
    return NextResponse.json({ mode: 'simulation', job: result.data }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    // Do not log request headers, tokens or message contents.
    return NextResponse.json({ error: 'Cola no disponible. No se ha confirmado ningún envío.' }, { status: 503 });
  }
}
