-- Isolated simulation queue. No existing automation or WhatsApp sender changes.
create table public.multichannel_workers (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  token_hash text not null unique check (length(token_hash) = 64),
  enabled boolean not null default true,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  unique (account_id, id)
);

-- Registering a line never enables it or clears a manual pause.
create table public.multichannel_lines (
  account_id uuid not null references public.accounts(id) on delete cascade,
  line_key text not null check (line_key ~ '^TEST-[A-Za-z0-9_-]{1,60}$'),
  channel text not null check (channel in ('sms', 'whatsapp_support')),
  paused boolean not null default true,
  available boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (account_id, line_key)
);
alter table public.multichannel_lines enable row level security;
revoke all on public.multichannel_lines from public, anon, authenticated;
grant select, insert, update on public.multichannel_lines to service_role;

-- Uses the worker transaction lock so a pause and a start have a definite order.
create function public.multichannel_line_control(
  p_account_id uuid, p_action text, p_line_key text,
  p_channel text default null, p_value boolean default null
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  l public.multichannel_lines;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_account_id::text, 0));
  if p_action = 'register' then
    insert into public.multichannel_lines(account_id, line_key, channel)
      values (p_account_id, p_line_key, p_channel)
      on conflict (account_id, line_key) do nothing;
    select * into l from public.multichannel_lines
      where account_id = p_account_id and line_key = p_line_key;
    if l.channel is distinct from p_channel then raise exception 'Line channel mismatch'; end if;
  elsif p_action in ('pause', 'availability') and p_value is not null then
    update public.multichannel_lines set
      paused = case when p_action = 'pause' then p_value else paused end,
      available = case when p_action = 'availability' then p_value else available end,
      updated_at = clock_timestamp()
      where account_id = p_account_id and line_key = p_line_key returning * into l;
    if not found then return null; end if;
  else
    raise exception 'Invalid line action';
  end if;
  return to_jsonb(l);
end;
$$;
revoke all on function public.multichannel_line_control(uuid, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.multichannel_line_control(uuid, text, text, text, boolean) to service_role;

create table public.multichannel_jobs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  channel text not null check (channel in ('sms', 'whatsapp_support')),
  mode text not null default 'simulation' check (mode = 'simulation'),
  line_key text not null check (line_key ~ '^TEST-[A-Za-z0-9_-]{1,60}$'),
  recipient text not null check (recipient ~ '^TEST-[A-Za-z0-9_-]{1,60}$'),
  body text not null check (length(body) between 1 and 4000),
  dedup_key text not null check (length(dedup_key) between 1 and 160),
  priority integer not null default 0 check (priority between 0 and 100),
  run_at timestamptz not null,
  expires_at timestamptz not null check (expires_at > run_at),
  status text not null default 'queued' check (status in
    ('queued', 'claimed', 'dispatching', 'simulated', 'needs_review', 'expired', 'cancelled')),
  worker_id uuid,
  last_worker_id uuid,
  claim_token uuid,
  lease_until timestamptz,
  attempts integer not null default 0,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  unique (account_id, dedup_key),
  foreign key (account_id, worker_id)
    references public.multichannel_workers(account_id, id),
  foreign key (account_id, last_worker_id)
    references public.multichannel_workers(account_id, id),
  check ((status in ('claimed', 'dispatching')) =
    (worker_id is not null and claim_token is not null and lease_until is not null))
);

create index multichannel_workers_account on public.multichannel_workers(account_id);
create index multichannel_jobs_due on public.multichannel_jobs(account_id, run_at)
  where status = 'queued';
create index multichannel_jobs_worker on public.multichannel_jobs(account_id, worker_id);
create index multichannel_jobs_last_worker on public.multichannel_jobs(account_id, last_worker_id);
-- Even distinct laptops cannot use the same simulated line simultaneously.
create unique index multichannel_jobs_line_busy on public.multichannel_jobs(account_id, line_key)
  where status in ('claimed', 'dispatching');
create unique index multichannel_jobs_worker_busy on public.multichannel_jobs(worker_id)
  where status in ('claimed', 'dispatching');

alter table public.multichannel_workers enable row level security;
alter table public.multichannel_jobs enable row level security;
-- Access goes through owner-checked server routes and revocable worker keys.
-- Neither anonymous users nor CRM clients can invoke queue transitions directly.
revoke all on public.multichannel_workers, public.multichannel_jobs from anon, authenticated;
grant select, insert, update, delete on public.multichannel_workers, public.multichannel_jobs to service_role;

create function public.multichannel_worker_step(
  p_worker_id uuid, p_action text, p_job_id uuid default null, p_claim_token uuid default null
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  w public.multichannel_workers;
  j public.multichannel_jobs;
  tick timestamptz := clock_timestamp();
begin
  select * into w from public.multichannel_workers where id = p_worker_id;
  if not found then raise exception 'Worker unavailable'; end if;
  -- Very short account transaction lock: claim/recovery/start/complete cannot race.
  perform pg_advisory_xact_lock(hashtextextended(w.account_id::text, 0));
  select * into w from public.multichannel_workers where id = p_worker_id for update;
  if not w.enabled then raise exception 'Worker unavailable'; end if;
  update public.multichannel_workers set last_seen_at = tick where id = w.id;

  if p_action = 'claim' then
    -- Before start: safe to reclaim. After start: delivery is unknown; no retry.
    update public.multichannel_jobs set
      status = case when status = 'dispatching' then 'needs_review' else 'queued' end,
      finished_at = case when status = 'dispatching' then tick else null end,
      worker_id = null, claim_token = null, lease_until = null
    where account_id = w.account_id and mode = 'simulation' and status in ('claimed', 'dispatching')
      and lease_until <= tick;
    update public.multichannel_jobs set status = 'expired', finished_at = tick
    where account_id = w.account_id and mode = 'simulation' and status = 'queued' and expires_at <= tick;

    -- Lost HTTP responses return the same claim, not a second job.
    select * into j from public.multichannel_jobs
    where account_id = w.account_id and mode = 'simulation' and worker_id = w.id
      and status in ('claimed', 'dispatching');
    if found then return to_jsonb(j); end if;

    select q.* into j from public.multichannel_jobs q
    where q.account_id = w.account_id and q.mode = 'simulation' and q.status = 'queued'
      and q.run_at <= tick and q.expires_at > tick
      and exists (select 1 from public.multichannel_lines l
        where l.account_id = q.account_id and l.line_key = q.line_key
          and l.channel = q.channel and not l.paused and l.available)
      and not exists (select 1 from public.multichannel_jobs busy
        where busy.account_id = q.account_id and busy.line_key = q.line_key
          and busy.status in ('claimed', 'dispatching'))
    -- One point per overdue hour, capped at 100 to prevent permanent starvation.
    order by least(100, q.priority + floor(extract(epoch from (tick - q.run_at)) / 3600)) desc,
      q.run_at, q.created_at, q.id
    limit 1 for update skip locked;
    if not found then return null; end if;
    if exists (select 1 from public.multichannel_jobs where worker_id = w.id
      and status in ('claimed', 'dispatching')) then return null; end if;
    update public.multichannel_jobs set status = 'claimed', worker_id = w.id, last_worker_id = w.id,
      claim_token = gen_random_uuid(), lease_until = tick + interval '2 minutes',
      attempts = attempts + 1
    where id = j.id returning * into j;
    return to_jsonb(j);
  end if;

  select * into j from public.multichannel_jobs
  where id = p_job_id and account_id = w.account_id and mode = 'simulation' for update;
  if not found then return null; end if;
  if j.worker_id is distinct from w.id or j.claim_token is distinct from p_claim_token
    or j.lease_until <= tick then return null; end if;

  if p_action = 'start' and j.status = 'claimed' then
    if j.expires_at <= tick then
      update public.multichannel_jobs set status = 'expired', finished_at = tick,
        worker_id = null, claim_token = null, lease_until = null where id = j.id;
      return null;
    end if;
    -- Recheck after claim: a human may have paused the line in the meantime.
    if not exists (select 1 from public.multichannel_lines l
      where l.account_id = j.account_id and l.line_key = j.line_key
        and l.channel = j.channel and not l.paused and l.available) then
      update public.multichannel_jobs set status = 'queued',
        worker_id = null, claim_token = null, lease_until = null where id = j.id;
      return null;
    end if;
    update public.multichannel_jobs set status = 'dispatching', started_at = tick
    where id = j.id returning * into j;
    return to_jsonb(j);
  elsif p_action = 'complete' and j.status = 'dispatching' then
    update public.multichannel_jobs set status = 'simulated', finished_at = tick,
      worker_id = null, claim_token = null, lease_until = null
    where id = j.id returning * into j;
    return to_jsonb(j);
  end if;
  return null;
end;
$$;
revoke all on function public.multichannel_worker_step(uuid, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.multichannel_worker_step(uuid, text, uuid, uuid) to service_role;
