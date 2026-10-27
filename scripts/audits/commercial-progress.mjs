import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

// Offline observer only: never executes the queue, changes flags or sends messages.
export function auditCommercialProgress(snapshot) {
  const now = Date.parse(snapshot.captured_at);
  if (!Number.isFinite(now)) throw Error('A valid capture time is required');
  const results = [], seen = new Set();
  for (const run of snapshot.runs) {
    if (!run.id || seen.has(run.id)) throw Error('Missing or repeated run ID');
    seen.add(run.id);
    const issues = [], sent = new Map(), known = new Set(run.step_ids);
    let lastPosition = -1;
    const events = run.steps_executed ?? [];
    for (const event of events) {
      if (event.status !== 'success') continue;
      const id = event.step_id?.replace(/:caption$/, '');
      if (!known.has(id)) issues.push('step_outside_course');
      if (/sent via Meta \(wamid/.test(event.detail ?? '')) {
        if (run.step_order) {
          const position = run.step_order.indexOf(id);
          if (position >= 0 && position < lastPosition) issues.push('send_order_regressed');
          lastPosition = Math.max(lastPosition, position);
        }
        if (sent.has(event.step_id)) issues.push('repeated_send_step');
        sent.set(event.step_id, true);
      }
    }
    const active = (run.pending ?? []).filter(p => ['pending','running','paused'].includes(p.status));
    for (const pending of active) {
      const due = Date.parse(pending.run_at);
      if (!Number.isFinite(due)) issues.push('invalid_schedule');
      if (pending.automation_id !== run.automation_id) issues.push('pending_course_mismatch');
      if (pending.status === 'pending' && now - due > 5 * 60_000) issues.push('overdue_pending');
      const last = Date.parse(run.last_customer_message_at);
      if (pending.status === 'pending' && Number.isFinite(last) && due >= last + 24 * 3600_000)
        issues.push('schedule_outside_service_window');
    }
    const closeSent = sent.has(run.close_step_id);
    if (run.status === 'success' && !closeSent && !run.payment_or_human)
      issues.push('completed_without_closing');
    if (run.status === 'partial' && !active.length && !run.payment_or_human)
      issues.push('partial_without_continuation');
    results.push({id:run.id, issues:[...new Set(issues)], sent_steps:sent.size,
      close_sent:closeSent, state:issues.length ? 'review'
        : closeSent ? 'closing_sent'
        : active.some(p=>p.status==='paused') ? 'held'
        : active.length ? 'scheduled' : 'finished',
      // A send result is not delivery evidence, and a scheduled close is not a completed close.
      delivery_verified:false});
  }
  return {captured_at:snapshot.captured_at, runs:results.length,
    needing_review:results.filter(r=>r.issues.length).length, results};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]) throw Error('Provide a saved read-only snapshot JSON');
  console.log(JSON.stringify(auditCommercialProgress(JSON.parse(readFileSync(process.argv[2],'utf8'))),null,2));
}
