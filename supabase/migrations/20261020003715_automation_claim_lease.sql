alter table public.automation_pending_executions
  add column if not exists claimed_at timestamptz;

comment on column public.automation_pending_executions.claimed_at is
  'Lease timestamp set when the scheduler claims a due execution.';

-- Rows left in running before leases existed cannot still be executing after
-- fifteen minutes. Put only those old claims back in the queue; the engine's
-- atomic pending -> running claim prevents two workers from taking one row.
update public.automation_pending_executions
set status = 'pending', claimed_at = null
where status = 'running'
  and run_at < now() - interval '15 minutes';

create index if not exists idx_automation_pending_stale_claim
  on public.automation_pending_executions(claimed_at)
  where status = 'running';
