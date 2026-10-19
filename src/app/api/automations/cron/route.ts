import { NextResponse } from 'next/server';
import { runIncompleteIntakes } from '@/lib/matriculas/incomplete-intake';
import { runSalesWindowFollowups } from '@/lib/ai/sales-window-followup';
import { dispatchDueReminderMessages } from '@/lib/reminders/dispatch';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { resumePendingExecution } from '@/lib/automations/engine';
import type { AutomationContext } from '@/lib/automations/engine';
import {
  expireSalesAssignments,
  routeWaitingSalesConversations,
} from '@/lib/ai/sales-routing';
import {
  reactivateExpiredManualControls,
  runIdleFollowups,
} from '@/lib/ai/followup';

/**
 * Drain due `automation_pending_executions` rows. Meant to be hit
 * on a schedule (Vercel Cron / external pinger) — requires a shared
 * secret via the `x-cron-secret` header to match
 * `AUTOMATION_CRON_SECRET`.
 *
 * The claim step (status = 'running') serves as a simple lock so
 * overlapping invocations don't double-process rows. Best-effort
 * only; expensive SELECT ... FOR UPDATE is avoided in favor of a
 * two-step UPDATE-by-id.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
  }
  const supplied = request.headers.get('x-cron-secret');
  if (supplied !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const admin = supabaseAdmin();
  // Payment-validated registrations must be refreshed before slower sales
  // followups; otherwise a busy followup can starve document preparation.
  try { await runIncompleteIntakes(admin); }
  catch (error) { console.error('No se pudieron revisar las matrículas pendientes', error); }
  // Resume promised automation steps before the slower routing and followup
  // jobs. A slow job must never delay a student's already-due block.
  const { data: due, error } = await admin
    .from('automation_pending_executions')
    .select('*')
    .eq('status', 'pending')
    .lte('run_at', new Date().toISOString())
    .order('run_at', { ascending: true })
    .limit(50);

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  let processed = 0;
  for (const dueRow of due ?? []) {
    const { data: claim } = await admin
      .from('automation_pending_executions')
      .update({ status: 'running' })
      .eq('id', dueRow.id)
      .eq('status', 'pending')
      .select('*')
      .maybeSingle();
    if (!claim) continue;

    const row = claim;
    await resumePendingExecution({
      id: row.id as string,
      automation_id: row.automation_id as string,
      account_id: row.account_id as string,
      user_id: row.user_id as string,
      contact_id: (row.contact_id as string | null) ?? null,
      log_id: (row.log_id as string | null) ?? null,
      parent_step_id: (row.parent_step_id as string | null) ?? null,
      branch: (row.branch as 'yes' | 'no' | null) ?? null,
      next_step_position: row.next_step_position as number,
      context: (row.context as AutomationContext) ?? {},
    });
    processed++;
  }
  const { error: reminderError } = await admin.rpc('publish_due_adviser_reminders');
  if (reminderError) console.error('No se pudieron entregar los recordatorios personales', reminderError);
  try { await dispatchDueReminderMessages(admin); }
  catch (error) { console.error('No se pudieron procesar los mensajes programados', error); }
  await expireSalesAssignments();
  await routeWaitingSalesConversations();
  await reactivateExpiredManualControls();
  await runIdleFollowups();
  try { await runSalesWindowFollowups(admin); }
  catch (error) { console.error('No se pudo procesar el cierre de ventas de 23 horas', error); }
  const { error: areaRoutingError } = await admin.rpc('route_waiting_area_conversations');
  if (areaRoutingError) return NextResponse.json({ error: 'No se pudo actualizar la cola de areas' }, { status: 500 });
  const { error: noticesError } = await admin.rpc('publish_operational_notices');
  if (noticesError) return NextResponse.json({ error: 'No se pudieron actualizar los avisos' }, { status: 500 });
  const { error: reportError } = await admin.rpc('publish_first_text_reports');
  if (reportError) return NextResponse.json({ error: 'No se pudieron actualizar las estadísticas de primeras frases' }, { status: 500 });
  const { error: casesError } = await admin.rpc('publish_case_reports');
  if (casesError) return NextResponse.json({ error: 'No se pudieron actualizar los reportes de quejas y soluciones' }, { status: 500 });
  const { error: birthdaysError } = await admin.rpc('publish_birthday_notices');
  if (birthdaysError) return NextResponse.json({ error: 'No se pudieron actualizar los avisos de cumpleanos' }, { status: 500 });
  return NextResponse.json({ processed });
}
