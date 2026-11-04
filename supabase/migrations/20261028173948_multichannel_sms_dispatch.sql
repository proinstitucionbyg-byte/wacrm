-- Extends the SAME queue. Local preparation only; no settings or jobs enabled.
alter table public.multichannel_lines drop constraint multichannel_lines_line_key_check;
alter table public.multichannel_lines add constraint multichannel_lines_line_key_check
  check (line_key ~ '^(TEST|SMS)-[A-Za-z0-9_-]{1,60}$');
alter table public.multichannel_lines add column device_key text;
alter table public.multichannel_lines add column ready_at timestamptz;
alter table public.multichannel_lines add column interval_seconds integer;
alter table public.multichannel_lines add column daily_limit integer;
alter table public.multichannel_lines add column limit_note text;
alter table public.multichannel_lines add constraint multichannel_sms_line_device check
  (line_key not like 'SMS-%' or (channel = 'sms' and device_key is not null and length(device_key) between 1 and 160
    and interval_seconds is not null and interval_seconds between 1 and 86400
    and daily_limit is not null and daily_limit between 1 and 100000
    and limit_note is not null and length(btrim(limit_note)) between 5 and 1000));

create table public.multichannel_sms_bindings (
  account_id uuid not null,
  line_key text not null check (line_key ~ '^SMS-[A-Za-z0-9_-]{1,60}$'),
  worker_id uuid not null,
  enabled boolean not null default true,
  ready_at timestamptz,
  primary key (account_id, line_key, worker_id),
  foreign key (account_id, line_key) references public.multichannel_lines(account_id, line_key),
  foreign key (account_id, worker_id) references public.multichannel_workers(account_id, id)
);
create index multichannel_sms_bindings_worker on public.multichannel_sms_bindings(worker_id);

-- Explicit, dated HUMAN consent, not a boolean copied from an imported campaign.
-- Collections intentionally have no grant type until finance is reconciled.
create table public.multichannel_sms_authorizations (
  account_id uuid not null references public.accounts(id),
  contact_id uuid not null references public.contacts(id),
  purpose text not null check (purpose in ('notice','support')),
  recipient text not null check (recipient ~ '^\+[1-9][0-9]{7,14}$'),
  granted boolean not null default false,
  expires_at timestamptz not null,
  evidence text not null check (length(btrim(evidence)) between 5 and 1000),
  reviewed_by uuid not null references public.profiles(user_id),
  reviewed_at timestamptz not null default now(),
  primary key (account_id, contact_id, purpose)
);
create index multichannel_sms_authorizations_contact on public.multichannel_sms_authorizations(contact_id);
create table public.multichannel_sms_authorization_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id),
  contact_id uuid not null references public.contacts(id),
  purpose text not null,
  recipient text not null,
  granted boolean not null,
  expires_at timestamptz not null,
  evidence text not null,
  reviewed_by uuid not null references public.profiles(user_id),
  reviewed_at timestamptz not null default now()
);
create index multichannel_sms_authorization_events_account on public.multichannel_sms_authorization_events(account_id,reviewed_at);
create index multichannel_sms_authorization_events_contact on public.multichannel_sms_authorization_events(contact_id);
create index multichannel_sms_authorizations_actor on public.multichannel_sms_authorizations(reviewed_by);
create index multichannel_sms_authorization_events_actor on public.multichannel_sms_authorization_events(reviewed_by);
alter table public.multichannel_sms_bindings enable row level security;
alter table public.multichannel_sms_authorizations enable row level security;
alter table public.multichannel_sms_authorization_events enable row level security;
revoke all on public.multichannel_sms_authorization_events from public,anon,authenticated;
grant select,insert on public.multichannel_sms_authorization_events to service_role;
revoke all on public.multichannel_sms_bindings, public.multichannel_sms_authorizations from public, anon, authenticated;
grant select, insert, update on public.multichannel_sms_bindings, public.multichannel_sms_authorizations to service_role;

alter table public.multichannel_jobs drop constraint multichannel_jobs_mode_check;
alter table public.multichannel_jobs drop constraint multichannel_jobs_line_key_check;
alter table public.multichannel_jobs drop constraint multichannel_jobs_recipient_check;
alter table public.multichannel_jobs drop constraint multichannel_jobs_status_check;
alter table public.multichannel_jobs add column contact_id uuid references public.contacts(id);
alter table public.multichannel_jobs add column purpose text;
alter table public.multichannel_jobs add column provider_id text;
alter table public.multichannel_jobs add column last_claim_token uuid;
alter table public.multichannel_jobs add column next_check_at timestamptz;
alter table public.multichannel_jobs add column provider_state text check (provider_state in ('accepted','sent','delivered','failed'));
alter table public.multichannel_jobs add constraint multichannel_jobs_mode_check check (mode in ('simulation','sms_live'));
alter table public.multichannel_jobs add constraint multichannel_jobs_transport_check check (
  (mode = 'simulation' and line_key ~ '^TEST-[A-Za-z0-9_-]{1,60}$'
    and recipient ~ '^TEST-[A-Za-z0-9_-]{1,60}$' and contact_id is null and purpose is null)
  or (mode = 'sms_live' and channel = 'sms' and line_key ~ '^SMS-[A-Za-z0-9_-]{1,60}$'
    and recipient ~ '^\+[1-9][0-9]{7,14}$' and contact_id is not null
    and purpose is not null and purpose in ('notice','support','collection')));
alter table public.multichannel_jobs add constraint multichannel_jobs_status_check check (status in
  ('queued','claimed','dispatching','simulated','needs_review','expired','cancelled','accepted','sent','delivered','failed'));
alter table public.multichannel_jobs add constraint multichannel_jobs_mode_status_check check
  ((mode = 'simulation' and status not in ('accepted','sent','delivered','failed')) or (mode = 'sms_live' and status <> 'simulated'));
alter table public.multichannel_jobs add constraint multichannel_jobs_provider_check check
  (provider_id is null or provider_id ~ '^wcm-[0-9a-f]{64}$');
create index multichannel_sms_jobs_contact on public.multichannel_jobs(contact_id) where mode = 'sms_live';
create index multichannel_sms_jobs_line_attempts on public.multichannel_jobs(account_id,line_key,started_at)
  where mode = 'sms_live' and started_at is not null;
create index multichannel_sms_jobs_reconcile on public.multichannel_jobs(account_id, next_check_at)
  where mode = 'sms_live' and status in ('accepted','sent','needs_review');

create function public.multichannel_sms_immutable() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if (old.mode = 'sms_live' or new.mode = 'sms_live') and
    row(new.mode,new.account_id,new.channel,new.line_key,new.recipient,new.body,new.dedup_key,
      new.contact_id,new.purpose,new.run_at,new.expires_at) is distinct from
    row(old.mode,old.account_id,old.channel,old.line_key,old.recipient,old.body,old.dedup_key,
      old.contact_id,old.purpose,old.run_at,old.expires_at) then
    raise exception 'SMS task identity is immutable';
  end if;
  return new;
end;
$$;
create trigger multichannel_sms_immutable before update on public.multichannel_jobs
  for each row execute function public.multichannel_sms_immutable();
revoke all on function public.multichannel_sms_immutable() from public, anon, authenticated;
grant execute on function public.multichannel_sms_immutable() to service_role;

create function public.multichannel_sms_control(p_account_id uuid, p_actor_id uuid, p_action text, p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  l public.multichannel_lines;
  c public.contacts;
  j public.multichannel_jobs;
  w public.multichannel_workers;
  tick timestamptz := clock_timestamp();
  target text := p_payload->>'line_key';
  recipient text := p_payload->>'recipient';
begin
  if not exists (select 1 from public.profiles where user_id = p_actor_id
    and account_id = p_account_id and account_role = 'owner') then
    raise exception 'Owner required' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_account_id::text, 0));
  tick := clock_timestamp();
  if p_action = 'register_worker' then
    insert into public.multichannel_workers(account_id,name,token_hash)
      values (p_account_id,p_payload->>'name',p_payload->>'token_hash') returning * into w;
    return jsonb_build_object('id',w.id,'name',w.name);
  elsif p_action = 'revoke_worker' then
    update public.multichannel_workers set enabled = false where account_id = p_account_id
      and id = (p_payload->>'worker_id')::uuid returning * into w;
    return case when found then jsonb_build_object('revoked',true) else null end;
  elsif p_action = 'configure_line' then
    if target !~ '^SMS-[A-Za-z0-9_-]{1,60}$' or target is null then raise exception 'Invalid SMS line'; end if;
    if not exists (select 1 from public.multichannel_workers where id = (p_payload->>'worker_id')::uuid
      and account_id = p_account_id and enabled) then raise exception 'Worker unavailable'; end if;
    insert into public.multichannel_lines(account_id,line_key,channel,device_key,interval_seconds,daily_limit,limit_note)
      values (p_account_id,target,'sms',p_payload->>'device_key',(p_payload->>'interval_seconds')::integer,
        (p_payload->>'daily_limit')::integer,p_payload->>'limit_note')
      on conflict (account_id,line_key) do nothing;
    select * into l from public.multichannel_lines where account_id = p_account_id and line_key = target;
    if l.device_key is distinct from (p_payload->>'device_key') then raise exception 'Device mismatch'; end if;
    -- Explicit owner configuration can change limits, never availability/pauses.
    update public.multichannel_lines set interval_seconds = (p_payload->>'interval_seconds')::integer,
      daily_limit = (p_payload->>'daily_limit')::integer,limit_note = p_payload->>'limit_note',updated_at = tick
      where account_id = p_account_id and line_key = target returning * into l;
    insert into public.multichannel_sms_bindings(account_id,line_key,worker_id)
      values (p_account_id,target,(p_payload->>'worker_id')::uuid) on conflict do nothing;
    return to_jsonb(l);
  elsif p_action in ('pause_line','set_line_availability') then
    if target !~ '^SMS-[A-Za-z0-9_-]{1,60}$' then raise exception 'Invalid SMS line'; end if;
    update public.multichannel_lines set
      paused = case when p_action = 'pause_line' then (p_payload->>'value')::boolean else paused end,
      available = case when p_action = 'set_line_availability' then (p_payload->>'value')::boolean else available end,
      updated_at = tick where account_id = p_account_id and line_key = target returning * into l;
    return case when found then to_jsonb(l) else null end;
  elsif p_action = 'set_permission' then
    select * into c from public.contacts where id = (p_payload->>'contact_id')::uuid and account_id = p_account_id;
    if not found then raise exception 'Contact unavailable'; end if;
    -- Human supplies the exact international destination; never guess a prefix.
    if recipient !~ '^\+[1-9][0-9]{7,14}$' or recipient is null or
      regexp_replace(coalesce(nullif(c.phone_normalized,''),c.phone,''),'[^0-9]','','g')
        <> substring(recipient from 2) then raise exception 'Contact destination mismatch'; end if;
    if (p_payload->>'granted')::boolean and (p_payload->>'expires_at')::timestamptz <= tick then
      raise exception 'Permission expired'; end if;
    insert into public.multichannel_sms_authorizations(account_id,contact_id,purpose,recipient,granted,expires_at,evidence,reviewed_by)
      values (p_account_id,c.id,p_payload->>'purpose',recipient,(p_payload->>'granted')::boolean,
        (p_payload->>'expires_at')::timestamptz,p_payload->>'evidence',p_actor_id)
      on conflict (account_id,contact_id,purpose) do update set recipient = excluded.recipient,
        granted = excluded.granted, expires_at = excluded.expires_at,evidence = excluded.evidence,
        reviewed_by = excluded.reviewed_by,reviewed_at = tick;
    insert into public.multichannel_sms_authorization_events(account_id,contact_id,purpose,recipient,granted,expires_at,evidence,reviewed_by,reviewed_at)
      values (p_account_id,c.id,p_payload->>'purpose',recipient,(p_payload->>'granted')::boolean,
        (p_payload->>'expires_at')::timestamptz,p_payload->>'evidence',p_actor_id,tick);
    return jsonb_build_object('saved',true);
  elsif p_action = 'enqueue' then
    if p_payload->>'purpose' not in ('notice','support') then
      raise exception 'Collection balance source unavailable'; end if;
    select * into c from public.contacts where id = (p_payload->>'contact_id')::uuid and account_id = p_account_id;
    if not found then raise exception 'Contact unavailable'; end if;
    select a.recipient into recipient from public.multichannel_sms_authorizations a
      where a.account_id = p_account_id and a.contact_id = c.id and a.purpose = p_payload->>'purpose'
      and a.granted and a.expires_at > tick
      and regexp_replace(coalesce(nullif(c.phone_normalized,''),c.phone,''),'[^0-9]','','g') = substring(a.recipient from 2);
    if not found then raise exception 'Current SMS permission required'; end if;
    if not exists (select 1 from public.multichannel_lines where account_id = p_account_id
      and line_key = target and channel = 'sms' and device_key is not null) then raise exception 'SMS line unavailable'; end if;
    insert into public.multichannel_jobs(account_id,mode,channel,line_key,contact_id,purpose,recipient,body,dedup_key,
      run_at,expires_at,priority)
      values (p_account_id,'sms_live','sms',target,c.id,p_payload->>'purpose',recipient,p_payload->>'body',
        p_account_id::text || ':' || (p_payload->>'dedup_key'),(p_payload->>'run_at')::timestamptz,
        (p_payload->>'expires_at')::timestamptz,coalesce((p_payload->>'priority')::integer,0)) returning * into j;
    return jsonb_build_object('id',j.id,'status',j.status,'mode',j.mode);
  end if;
  raise exception 'Unknown SMS owner action';
end;
$$;

-- One authoritative read reused by claim/start/permit. Does not trust worker
-- booleans for consent, human takeover, account, contact or payment balance.
create function public.multichannel_sms_eligibility(p_worker_id uuid, p_job_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  j public.multichannel_jobs;
  l public.multichannel_lines;
  tick timestamptz := clock_timestamp();
  permission_ok boolean := false;
  destination_ok boolean := false;
  human_active boolean := true;
  manual_pause boolean := true;
  binding_ok boolean := false;
  ready boolean := false;
  limits_ok boolean := false;
begin
  select * into j from public.multichannel_jobs where id = p_job_id and mode = 'sms_live';
  if not found then return jsonb_build_object('allowed',false); end if;
  select * into l from public.multichannel_lines where account_id = j.account_id and line_key = j.line_key;
  select exists (select 1 from public.multichannel_workers w join public.multichannel_sms_bindings b
    on b.worker_id = w.id and b.account_id = w.account_id where w.id = p_worker_id and w.enabled
    and b.enabled and b.account_id = j.account_id and b.line_key = j.line_key) into binding_ok;
  select exists (select 1 from public.contacts c where c.id = j.contact_id and c.account_id = j.account_id
    and regexp_replace(coalesce(nullif(c.phone_normalized,''),c.phone,''),'[^0-9]','','g') = substring(j.recipient from 2)) into destination_ok;
  select exists (select 1 from public.multichannel_sms_authorizations a where a.account_id = j.account_id
    and a.contact_id = j.contact_id and a.purpose = j.purpose and a.recipient = j.recipient
    and a.granted and a.expires_at > tick) into permission_ok;
  select exists (select 1 from public.conversations where account_id = j.account_id and contact_id = j.contact_id
    and assigned_agent_id is not null),
    exists (select 1 from public.conversations where account_id = j.account_id and contact_id = j.contact_id
    and automation_enabled = false) into human_active, manual_pause;
  select exists (select 1 from public.multichannel_sms_bindings where worker_id = p_worker_id
    and account_id = j.account_id and line_key = j.line_key and enabled
    and ready_at > tick - interval '45 seconds') into ready;
  -- Count initiated attempts conservatively, including uncertain outcomes.
  select not exists (select 1 from public.multichannel_jobs q where q.account_id = j.account_id
      and q.mode = 'sms_live' and q.line_key = j.line_key and q.id <> j.id
      and q.started_at > tick - make_interval(secs => l.interval_seconds))
    and (select count(*) from public.multichannel_jobs q where q.account_id = j.account_id
      and q.mode = 'sms_live' and q.line_key = j.line_key and q.id <> j.id
      and q.started_at >= (date_trunc('day',tick at time zone 'America/Lima') at time zone 'America/Lima')) < l.daily_limit
    into limits_ok;
  return jsonb_build_object('accountId',j.account_id,'jobId',j.id,'lineKey',j.line_key,'deviceKey',l.device_key,
    'allowed',coalesce(binding_ok and permission_ok and destination_ok and not human_active and not manual_pause
      and not l.paused and l.available and ready and limits_ok and j.purpose in ('notice','support')
      and j.run_at <= tick and j.expires_at > tick,false),
    'paused',coalesce(l.paused,true) or manual_pause,'permissionConfirmed',permission_ok and destination_ok,
    'humanActive',human_active,'lineAvailable',coalesce(l.available,false),'deviceReady',ready,
    'paymentStatus',case when j.purpose = 'collection' then 'unknown' else 'not_required' end,'checkedAt',tick);
end;
$$;

create function public.multichannel_sms_step(p_worker_id uuid, p_action text, p_line_key text, p_device_key text,
  p_job_id uuid default null, p_claim_token uuid default null, p_state text default null,
  p_provider_id text default null, p_ready boolean default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  w public.multichannel_workers;
  l public.multichannel_lines;
  j public.multichannel_jobs;
  tick timestamptz;
  reconcile_only boolean := false;
  state text;
begin
  select * into w from public.multichannel_workers where id = p_worker_id and enabled;
  if not found then raise exception 'Worker unavailable' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(w.account_id::text,0));
  tick := clock_timestamp();
  -- Recheck revocation after waiting for the account lock.
  if not exists (select 1 from public.multichannel_workers where id = w.id and enabled) then
    raise exception 'Worker unavailable' using errcode = '42501'; end if;
  select l0.* into l from public.multichannel_lines l0 join public.multichannel_sms_bindings b
    on b.account_id = l0.account_id and b.line_key = l0.line_key
    where l0.account_id = w.account_id and l0.line_key = p_line_key and l0.device_key = p_device_key
      and b.worker_id = w.id and b.enabled;
  if not found then raise exception 'Line not assigned' using errcode = '42501'; end if;
  update public.multichannel_workers set last_seen_at = tick where id = w.id;
  if p_action = 'identity' then
    return jsonb_build_object('accountId',w.account_id,'workerId',w.id,'lineKey',l.line_key,'deviceKey',l.device_key);
  elsif p_action = 'heartbeat' and p_ready is not null then
    update public.multichannel_sms_bindings set ready_at = case when p_ready then tick else null end
      where account_id = w.account_id and line_key = l.line_key and worker_id = w.id;
    update public.multichannel_lines set ready_at = case when p_ready then tick else null end
      where account_id = w.account_id and line_key = l.line_key;
    return jsonb_build_object('recorded',true);
  elsif p_action = 'claim' then
    update public.multichannel_jobs set
      status = case when status = 'dispatching' then 'needs_review' else 'queued' end,
      finished_at = case when status = 'dispatching' then tick else null end,
      next_check_at = case when status = 'dispatching' then tick else null end,
      worker_id = null, claim_token = null, lease_until = null
      where account_id = w.account_id and mode = 'sms_live' and status in ('claimed','dispatching') and lease_until <= tick;
    update public.multichannel_jobs set status = 'expired',finished_at = tick
      where account_id = w.account_id and mode = 'sms_live' and status = 'queued' and expires_at <= tick;
    select * into j from public.multichannel_jobs where account_id = w.account_id and worker_id = w.id
      and status in ('claimed','dispatching');
    if found then
      if j.mode = 'sms_live' and j.line_key = l.line_key then return to_jsonb(j); end if;
      return null;
    end if;
    if exists (select 1 from public.multichannel_jobs where account_id = w.account_id and line_key = l.line_key
      and status in ('claimed','dispatching')) then return null; end if;
    -- Reconciliation is GET-only, also when sending is paused or consent revoked.
    if exists (select 1 from public.multichannel_sms_bindings where worker_id = w.id and account_id = w.account_id
      and line_key = l.line_key and ready_at > tick - interval '45 seconds') then
      select * into j from public.multichannel_jobs where account_id = w.account_id and mode = 'sms_live'
        and line_key = l.line_key and status in ('accepted','sent','needs_review') and started_at is not null
        and next_check_at <= tick order by next_check_at,id limit 1 for update skip locked;
      reconcile_only := found;
    end if;
    if not reconcile_only then
      select q.* into j from public.multichannel_jobs q where q.account_id = w.account_id and q.mode = 'sms_live'
        and q.line_key = l.line_key and q.status = 'queued' and q.run_at <= tick and q.expires_at > tick
        and (public.multichannel_sms_eligibility(w.id,q.id)->>'allowed')::boolean
        order by least(100,q.priority + floor(extract(epoch from (tick-q.run_at))/3600)) desc,
          q.run_at,q.created_at,q.id limit 1 for update skip locked;
      if not found then return null; end if;
    end if;
    update public.multichannel_jobs set status = case when reconcile_only then 'dispatching' else 'claimed' end,
      worker_id = w.id,last_worker_id = w.id,claim_token = gen_random_uuid(),lease_until = tick + interval '2 minutes',
      attempts = attempts + case when reconcile_only then 0 else 1 end where id = j.id returning * into j;
    return to_jsonb(j);
  end if;
  select * into j from public.multichannel_jobs where id = p_job_id and account_id = w.account_id
    and mode = 'sms_live' and line_key = l.line_key for update;
  if not found then return null; end if;
  if p_action = 'record' and j.worker_id is null and j.last_worker_id = w.id and j.last_claim_token = p_claim_token
    and j.provider_id = p_provider_id then return jsonb_build_object('recorded',true,'state',j.status); end if;
  if j.worker_id is distinct from w.id or j.claim_token is distinct from p_claim_token or j.lease_until <= tick then return null; end if;
  if p_action = 'permit' then return public.multichannel_sms_eligibility(w.id,j.id); end if;
  if p_action = 'start' and j.status = 'claimed' then
    if not (public.multichannel_sms_eligibility(w.id,j.id)->>'allowed')::boolean then
      update public.multichannel_jobs set status = 'queued',worker_id = null,claim_token = null,lease_until = null
        where id = j.id;
      return null;
    end if;
    update public.multichannel_jobs set status = 'dispatching',started_at = tick,
      provider_id = 'wcm-' || encode(sha256(convert_to(j.dedup_key,'UTF8')),'hex')
      where id = j.id returning * into j;
    return to_jsonb(j);
  elsif p_action = 'record' and j.status = 'dispatching' then
    if p_state not in ('accepted','sent','delivered','failed','needs_review') or p_state is null
      or p_provider_id is distinct from j.provider_id then raise exception 'Invalid provider result'; end if;
    state := p_state;
    if j.provider_state in ('delivered','failed') then state := j.provider_state;
    elsif j.provider_state = 'sent' and p_state = 'accepted' then state := 'sent'; end if;
    update public.multichannel_jobs set status = state,finished_at = tick,last_claim_token = claim_token,
      provider_state = case when state = 'needs_review' then provider_state else state end,
      worker_id = null,claim_token = null,lease_until = null,
      next_check_at = case when state in ('accepted','sent') then tick + interval '30 seconds'
        when state = 'needs_review' then tick + interval '5 minutes' else null end
      where id = j.id;
    return jsonb_build_object('recorded',true,'state',state);
  end if;
  return null;
end;
$$;
revoke all on function public.multichannel_sms_control(uuid,uuid,text,jsonb),
  public.multichannel_sms_eligibility(uuid,uuid),
  public.multichannel_sms_step(uuid,text,text,text,uuid,uuid,text,text,boolean) from public,anon,authenticated;
grant execute on function public.multichannel_sms_control(uuid,uuid,text,jsonb),
  public.multichannel_sms_eligibility(uuid,uuid),
  public.multichannel_sms_step(uuid,text,text,text,uuid,uuid,text,text,boolean) to service_role;
