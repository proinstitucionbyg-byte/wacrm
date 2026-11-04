import { createHash, randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { simulationCalendarRange } from '@/lib/multichannel/calendar-range';
import { simulationJobSchema, simulationLineKeySchema, workerRegistrationSchema } from '@/lib/multichannel/protocol';
import { z } from 'zod';

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('register_line'), line_key: simulationLineKeySchema, channel: z.enum(['sms', 'whatsapp_support']) }),
  z.object({ action: z.literal('pause_line'), line_key: simulationLineKeySchema, value: z.boolean() }),
  z.object({ action: z.literal('set_line_availability'), line_key: simulationLineKeySchema, value: z.boolean() }),
  z.object({ action: z.literal('register_worker'), worker: workerRegistrationSchema }),
  z.object({ action: z.literal('revoke_worker'), worker_id: z.string().uuid() }),
  z.object({ action: z.literal('enqueue'), job: simulationJobSchema }),
  z.object({
    action: z.literal('enqueue_batch'),
    jobs: z.array(simulationJobSchema).min(1).max(500).refine(
      jobs => new Set(jobs.map(job => job.dedup_key)).size === jobs.length,
      'El lote contiene claves de envío repetidas.',
    ),
  }),
  z.object({ action: z.literal('cancel_job'), job_id: z.string().uuid() }),
]);

const CALENDAR_PAGE_SIZE = 500;
const CALENDAR_MAX_PAGE = 1000;

export async function GET(request: Request) {
  try {
    const ctx = await requireRole('owner');
    if (process.env.MULTICHANNEL_SIMULATION_ENABLED !== 'true') {
      return NextResponse.json({ error: 'Simulación multicanal todavía no habilitada.' }, { status: 503 });
    }
    const params = new URL(request.url).searchParams;
    const month = params.get('month');
    const rawPage = params.get('page');
    const page = rawPage === null ? 0 : Number(rawPage);
    if (rawPage !== null && (month === null || !/^\d+$/.test(rawPage)
      || !Number.isSafeInteger(page) || page < 0 || page > CALENDAR_MAX_PAGE)) {
      return NextResponse.json({ error: 'La página del calendario no es válida.' }, { status: 400 });
    }
    let range: ReturnType<typeof simulationCalendarRange> | null = null;
    if (month !== null) {
      try { range = simulationCalendarRange(month); }
      catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : 'Mes inválido.' }, { status: 400 });
      }
    }
    const db = supabaseAdmin();
    let jobsQuery = db.from('multichannel_jobs').select('*').eq('account_id', ctx.accountId).eq('mode', 'simulation');
    jobsQuery = range
      ? jobsQuery.gte('run_at', range.start).lt('run_at', range.end)
          .order('run_at', { ascending: true }).order('id', { ascending: true })
          .range(page * CALENDAR_PAGE_SIZE, page * CALENDAR_PAGE_SIZE + CALENDAR_PAGE_SIZE)
      : jobsQuery.order('created_at', { ascending: false }).limit(100);
    const [jobs, workers, lines] = await Promise.all([
      jobsQuery,
      db.from('multichannel_workers').select('id,name,enabled,last_seen_at,created_at')
        .eq('account_id', ctx.accountId).order('created_at').limit(100),
      db.from('multichannel_lines').select('line_key,channel,paused,available,updated_at')
        .eq('account_id', ctx.accountId).like('line_key', 'TEST-%').order('line_key').limit(100),
    ]);
    if (jobs.error) throw jobs.error;
    if (workers.error) throw workers.error;
    if (lines.error) throw lines.error;
    const jobRows = jobs.data ?? [];
    const calendarHasMore = !!range && jobRows.length > CALENDAR_PAGE_SIZE;
    return NextResponse.json({ mode: 'simulation',
      jobs: range ? jobRows.slice(0, CALENDAR_PAGE_SIZE) : jobRows,
      workers: workers.data, lines: lines.data, calendarMonth: month,
      calendarPage: range ? page : null, calendarHasMore }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) { return toErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('owner');
    if (process.env.MULTICHANNEL_SIMULATION_ENABLED !== 'true') {
      return NextResponse.json({ error: 'Simulación multicanal todavía no habilitada.' }, { status: 503 });
    }
    const input = actionSchema.safeParse(await request.json().catch(() => null));
    if (!input.success) return NextResponse.json({ error: input.error.flatten() }, { status: 400 });
    const db = supabaseAdmin();
    const action = input.data;
    if (action.action === 'cancel_job') {
      // Only a not-yet-claimed simulation job can be cancelled.
      const { data, error } = await db.from('multichannel_jobs').update({
        status: 'cancelled', finished_at: new Date().toISOString(),
      }).eq('id', action.job_id).eq('account_id', ctx.accountId).eq('mode', 'simulation')
        .eq('status', 'queued').select('id,status').maybeSingle();
      if (error) throw error;
      return NextResponse.json(data ? { cancelled: true, job: data } : {
        error: 'No se canceló: el trabajo no existe, ya empezó o ya terminó.',
      }, { status: data ? 200 : 409, headers: { 'Cache-Control': 'no-store' } });
    }
    if (action.action === 'register_line' || action.action === 'pause_line' || action.action === 'set_line_availability') {
      const { data, error } = await db.rpc('multichannel_line_control', {
        p_account_id: ctx.accountId,
        p_action: action.action === 'register_line' ? 'register' : action.action === 'pause_line' ? 'pause' : 'availability',
        p_line_key: action.line_key,
        p_channel: action.action === 'register_line' ? action.channel : null,
        p_value: action.action === 'register_line' ? null : action.value,
      });
      if (error) throw error;
      return NextResponse.json(data ? { mode: 'simulation', line: data } : { error: 'Línea no encontrada.' }, {
        status: data ? 200 : 404, headers: { 'Cache-Control': 'no-store' },
      });
    }
    if (action.action === 'register_worker') {
      const token = `wcm_${randomBytes(32).toString('hex')}`;
      const { data, error } = await db.from('multichannel_workers').insert({
        account_id: ctx.accountId, name: action.worker.name,
        token_hash: createHash('sha256').update(token).digest('hex'),
      }).select('id,name').single();
      if (error) throw error;
      // Secret shown once to the owner, never stored in plaintext or returned by GET.
      return NextResponse.json({ worker: data, token, mode: 'simulation' }, {
        status: 201, headers: { 'Cache-Control': 'no-store' },
      });
    }
    if (action.action === 'revoke_worker') {
      const { data, error } = await db.from('multichannel_workers').update({ enabled: false })
        .eq('id', action.worker_id).eq('account_id', ctx.accountId).select('id').maybeSingle();
      if (error) throw error;
      return NextResponse.json(data ? { revoked: true } : { error: 'Laptop no encontrada.' }, {
        status: data ? 200 : 404,
      });
    }
    if (action.action === 'enqueue_batch') {
      // One INSERT statement: the entire batch succeeds or none of it is saved.
      const { data, error } = await db.from('multichannel_jobs').insert(
        action.jobs.map(job => ({...job, account_id:ctx.accountId, mode:'simulation'})),
      ).select('id,status,mode');
      if (error?.code === '23505') {
        return NextResponse.json({error:'Hay trabajos ya registrados. No se guardó ninguna parte del lote.'}, {status:409});
      }
      if (error) throw error;
      return NextResponse.json({mode:'simulation', enqueued:data.length, jobs:data}, {status:201});
    }
    const { data, error } = await db.from('multichannel_jobs').insert({
      ...action.job, account_id: ctx.accountId, mode: 'simulation',
    }).select('id,status,mode').single();
    if (error?.code === '23505') {
      return NextResponse.json({ error: 'Este envío ya está registrado; no se ha duplicado.' }, { status: 409 });
    }
    if (error) throw error;
    return NextResponse.json(data, { status: 201 });
  } catch (error) { return toErrorResponse(error); }
}
