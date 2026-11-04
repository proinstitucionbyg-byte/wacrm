-- Owner-only HTTPS control of the existing, outbound-polling local worker.
-- No browser profile, local access token or worker token is stored here.
create table public.whatsapp_management_state(
 worker_id uuid primary key,account_id uuid not null,
 snapshot jsonb not null check(jsonb_typeof(snapshot)='array'),seen_at timestamptz not null default now(),
 foreign key(account_id,worker_id) references public.multichannel_workers(account_id,id) on delete cascade
);
create table public.whatsapp_management_commands(
 id uuid primary key default gen_random_uuid(),account_id uuid not null,worker_id uuid not null,
 operation text not null check(operation in ('create','connect','stop','unlink','recover','replace')),
 line_key text,label text,expected_phone text,
 status text not null default 'pending' check(status in ('pending','running','done','error','needs_review')),
 created_at timestamptz not null default now(),lease_until timestamptz,finished_at timestamptz,result text,
 foreign key(account_id,worker_id) references public.multichannel_workers(account_id,id) on delete cascade
);
create unique index whatsapp_management_one_command on public.whatsapp_management_commands(worker_id) where status in ('pending','running');
alter table public.whatsapp_management_state enable row level security;
alter table public.whatsapp_management_commands enable row level security;
revoke all on public.whatsapp_management_state,public.whatsapp_management_commands from public,anon,authenticated;
grant select,insert,update,delete on public.whatsapp_management_state,public.whatsapp_management_commands to service_role;

create function public.claim_whatsapp_management_command(p_worker_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare job public.whatsapp_management_commands;tick timestamptz:=clock_timestamp();
begin
 if not exists(select 1 from public.multichannel_workers where id=p_worker_id and enabled) then raise exception 'Worker unavailable' using errcode='42501';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_worker_id::text||':management',0));
 update public.whatsapp_management_commands set status='needs_review',finished_at=tick,result='La ejecución no confirmó su resultado. Revisa la línea antes de volver a intentarlo.'
  where worker_id=p_worker_id and status='running' and lease_until<=tick;
 update public.whatsapp_management_commands set status='error',finished_at=tick,result='La solicitud venció sin ejecutarse.'
  where worker_id=p_worker_id and status='pending' and created_at<tick-interval '5 minutes';
 if exists(select 1 from public.whatsapp_management_commands where worker_id=p_worker_id and status='running') then return null;end if;
 select * into job from public.whatsapp_management_commands where worker_id=p_worker_id and status='pending' order by created_at,id limit 1 for update skip locked;
 if not found then return null;end if;
 update public.whatsapp_management_commands set status='running',lease_until=tick+interval '2 minutes' where id=job.id returning * into job;
 return to_jsonb(job);
end;$$;
revoke all on function public.claim_whatsapp_management_command(uuid) from public,anon,authenticated;
grant execute on function public.claim_whatsapp_management_command(uuid) to service_role;
notify pgrst,'reload schema';
