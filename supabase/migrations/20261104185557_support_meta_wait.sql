alter table public.conversations add column whatsapp_support_wait_until timestamptz;
create table public.whatsapp_support_waits(
 id uuid primary key default gen_random_uuid(),account_id uuid not null references public.accounts(id) on delete cascade,
 conversation_id uuid not null references public.conversations(id) on delete cascade,
 source_message_id uuid not null unique references public.messages(id) on delete cascade,
 run_at timestamptz not null,status text not null default 'pending' check(status in('pending','running','done','cancelled','needs_review')),
 first_inbound boolean not null,contact_created boolean not null,claimed_at timestamptz,completed_at timestamptz,result text,
 created_at timestamptz not null default now()
);
alter table public.whatsapp_support_waits enable row level security;
revoke all on public.whatsapp_support_waits from public,anon,authenticated;
grant select,insert,update,delete on public.whatsapp_support_waits to service_role;
create unique index whatsapp_support_one_wait on public.whatsapp_support_waits(account_id,conversation_id) where status in('pending','running');
create index whatsapp_support_wait_due on public.whatsapp_support_waits(run_at) where status='pending';
create function public.enqueue_whatsapp_support_wait(p_account_id uuid,p_conversation_id uuid,p_provider_id text,p_first_inbound boolean,p_contact_created boolean)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare source public.messages;queued public.whatsapp_support_waits;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_account_id::text||':support-wait:'||p_conversation_id::text,0));
 if not exists(select 1 from public.whatsapp_support_routes where account_id=p_account_id and enabled) then raise exception 'Support route unavailable';end if;
 select m.* into source from public.messages m join public.conversations c on c.id=m.conversation_id where m.conversation_id=p_conversation_id and c.account_id=p_account_id and m.message_id=p_provider_id and m.sender_type='customer' and m.whatsapp_session_line_key is null;
 if not found then raise exception 'Cloud source unavailable';end if;
 select * into queued from public.whatsapp_support_waits where account_id=p_account_id and conversation_id=p_conversation_id and status in('pending','running');
 if not found then
  insert into public.whatsapp_support_waits(account_id,conversation_id,source_message_id,run_at,first_inbound,contact_created)
  values(p_account_id,p_conversation_id,source.id,source.created_at+interval '3 minutes',p_first_inbound,p_contact_created)
  on conflict(source_message_id) do nothing returning * into queued;
 end if;
 update public.conversations set whatsapp_support_wait_until=queued.run_at where id=p_conversation_id and account_id=p_account_id;
 return jsonb_build_object('waiting',true,'run_at',queued.run_at);
end;$$;
create function public.claim_whatsapp_support_waits()
returns setof public.whatsapp_support_waits language sql security invoker set search_path='' as $$
 update public.whatsapp_support_waits w set status='running',claimed_at=clock_timestamp()
 where w.id in(select q.id from public.whatsapp_support_waits q join public.whatsapp_support_routes r on r.account_id=q.account_id and r.enabled
  where q.status='pending' and q.run_at<=clock_timestamp() order by q.run_at,q.id for update of q skip locked limit 8)
 returning w.*;
$$;
revoke all on function public.enqueue_whatsapp_support_wait(uuid,uuid,text,boolean,boolean) from public,anon,authenticated;
revoke all on function public.claim_whatsapp_support_waits() from public,anon,authenticated;
grant execute on function public.enqueue_whatsapp_support_wait(uuid,uuid,text,boolean,boolean),public.claim_whatsapp_support_waits() to service_role;
notify pgrst,'reload schema';
