-- Reuses multichannel_jobs. Requires the existing SMS extension to be applied
-- after the base queue, followed by the WhatsApp session binding migration.
create table public.multichannel_campaigns (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references public.accounts(id),
 request_id uuid not null,name text not null check(length(btrim(name)) between 1 and 100),
 created_by uuid not null references public.profiles(user_id),
 review_hash text not null check(review_hash ~ '^[a-f0-9]{64}$'),
 status text not null default 'draft' check(status in('draft','active','paused','cancelled','completed')),
 routes jsonb not null check(jsonb_typeof(routes)='array' and jsonb_array_length(routes) between 1 and 11),
 purpose text not null check(purpose in('notice','support')),
 body text not null check(length(btrim(body)) between 1 and 4000),
 run_at timestamptz not null,expires_at timestamptz not null check(expires_at>run_at),
 interval_seconds integer not null check(interval_seconds between 1 and 86400),
 block_size integer not null check(block_size between 1 and 1000),
 block_pause_seconds integer not null check(block_pause_seconds between 0 and 604800),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(account_id,request_id),unique(account_id,id)
);
alter table public.multichannel_campaigns enable row level security;
revoke all on public.multichannel_campaigns from public,anon,authenticated;
grant select,insert,update on public.multichannel_campaigns to service_role;
alter table public.multichannel_whatsapp_session_lines add column campaign_ready_at timestamptz;
alter table public.multichannel_jobs add column campaign_id uuid;
alter table public.multichannel_jobs add column campaign_permission boolean not null default false;
alter table public.multichannel_jobs add column permission_expires_at timestamptz;
alter table public.multichannel_jobs add column permission_evidence text;
alter table public.multichannel_jobs add column routing_alert text;
alter table public.multichannel_jobs add column campaign_sequence integer check(campaign_sequence>=0);
alter table public.multichannel_jobs add column campaign_conversation_id uuid references public.conversations(id);
alter table public.multichannel_jobs add column campaign_message_row_id uuid references public.messages(id);
alter table public.multichannel_jobs add foreign key(account_id,campaign_id) references public.multichannel_campaigns(account_id,id);
create unique index multichannel_campaign_contact_mode on public.multichannel_jobs(account_id,campaign_id,contact_id,mode) where campaign_id is not null;
create unique index multichannel_campaign_recipient_mode on public.multichannel_jobs(account_id,campaign_id,recipient,mode) where campaign_id is not null;
-- One hub may own ten isolated WhatsApp profiles. Keep the existing SMS/
-- simulation worker fence, and serialize WhatsApp work by its physical line.
drop index public.multichannel_jobs_worker_busy;
create unique index multichannel_jobs_worker_busy on public.multichannel_jobs(worker_id) where status in('claimed','dispatching') and mode<>'whatsapp_live';
alter table public.multichannel_jobs drop constraint multichannel_jobs_mode_check;
alter table public.multichannel_jobs drop constraint multichannel_jobs_transport_check;
alter table public.multichannel_jobs drop constraint multichannel_jobs_mode_status_check;
alter table public.multichannel_jobs drop constraint multichannel_jobs_provider_check;
alter table public.multichannel_jobs add constraint multichannel_jobs_mode_check check(mode in('simulation','sms_live','whatsapp_live'));
alter table public.multichannel_jobs add constraint multichannel_jobs_transport_check check(
 (mode='simulation' and line_key ~ '^TEST-[A-Za-z0-9_-]{1,60}$' and recipient ~ '^TEST-[A-Za-z0-9_-]{1,60}$' and contact_id is null and purpose is null)
 or(mode='sms_live' and channel='sms' and line_key ~ '^SMS-[A-Za-z0-9_-]{1,60}$' and recipient ~ '^\+[1-9][0-9]{7,14}$' and contact_id is not null and purpose in('notice','support','collection'))
 or(mode='whatsapp_live' and channel='whatsapp_support' and line_key ~ '^WA-[A-Za-z0-9_-]{1,60}$' and recipient ~ '^\+[1-9][0-9]{7,14}$' and contact_id is not null and purpose in('notice','support') and campaign_id is not null)
);
alter table public.multichannel_jobs add constraint multichannel_jobs_mode_status_check check(
 (mode='simulation' and status not in('accepted','sent','delivered','failed')) or(mode in('sms_live','whatsapp_live') and status<>'simulated'));
alter table public.multichannel_jobs add constraint multichannel_jobs_provider_check check(
 provider_id is null or(mode='sms_live' and provider_id ~ '^wcm-[0-9a-f]{64}$') or(mode='whatsapp_live' and length(provider_id) between 1 and 1024));

create function public.multichannel_campaign_control(p_account_id uuid,p_actor_id uuid,p_action text,p_payload jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c public.multichannel_campaigns; rec jsonb; r jsonb; person public.contacts; due timestamptz; idx integer:=0; phone text; n integer; tick timestamptz:=clock_timestamp();
begin
 if not exists(select 1 from public.profiles where account_id=p_account_id and user_id=p_actor_id and account_role='owner') then raise exception 'Owner required' using errcode='42501'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_account_id::text,0));
 if p_action='create' then
  select * into c from public.multichannel_campaigns where account_id=p_account_id and request_id=(p_payload->>'request_id')::uuid;
  if found then
   if c.review_hash is distinct from p_payload->>'review_hash' then raise exception 'Request content conflict' using errcode='23505'; end if;
   return jsonb_build_object('id',c.id,'status',c.status,'duplicate',true,'review_hash',c.review_hash);
  end if;
  if jsonb_typeof(p_payload->'recipients')<>'array' or jsonb_array_length(p_payload->'recipients') not between 1 and 1000
    or jsonb_typeof(p_payload->'routes')<>'array' or jsonb_array_length(p_payload->'routes') not between 1 and 11
    or p_payload->'routes'->0->>'channel'<>'whatsapp_support' then raise exception 'Invalid audience or routes' using errcode='22023'; end if;
  if (p_payload->>'expires_at')::timestamptz<=tick then raise exception 'Expired campaign' using errcode='22023'; end if;
  if(select count(distinct item->>'contact_id') from jsonb_array_elements(p_payload->'recipients') item)<>jsonb_array_length(p_payload->'recipients')
    or(select count(distinct item->>'line_key') from jsonb_array_elements(p_payload->'routes') item)<>jsonb_array_length(p_payload->'routes') then raise exception 'Duplicate audience or routes' using errcode='22023'; end if;
  n:=0;
  for r in select value from jsonb_array_elements(p_payload->'routes') loop
   n:=n+1;
   if r->>'channel'='whatsapp_support' then
    if n>10 or not exists(select 1 from public.multichannel_whatsapp_session_lines where account_id=p_account_id and line_key=r->>'line_key') then raise exception 'Unknown WhatsApp line' using errcode='42501'; end if;
   elsif r->>'channel'='sms' then
    if n<>jsonb_array_length(p_payload->'routes') or not exists(select 1 from public.multichannel_lines where account_id=p_account_id and line_key=r->>'line_key' and channel='sms') then raise exception 'Invalid SMS fallback' using errcode='42501'; end if;
   else raise exception 'Unknown route' using errcode='22023'; end if;
  end loop;
  insert into public.multichannel_campaigns(account_id,request_id,name,created_by,review_hash,routes,purpose,body,run_at,expires_at,interval_seconds,block_size,block_pause_seconds)
   values(p_account_id,(p_payload->>'request_id')::uuid,p_payload->>'name',p_actor_id,p_payload->>'review_hash',p_payload->'routes',p_payload->>'purpose',btrim(p_payload->>'body'),(p_payload->>'run_at')::timestamptz,(p_payload->>'expires_at')::timestamptz,(p_payload->>'interval_seconds')::integer,(p_payload->>'block_size')::integer,(p_payload->>'block_pause_seconds')::integer) returning * into c;
  for rec in select value from jsonb_array_elements(p_payload->'recipients') loop
   select * into person from public.contacts where account_id=p_account_id and id=(rec->>'contact_id')::uuid;
   if not found then raise exception 'Contact outside account' using errcode='42501'; end if;
   phone:='+'||regexp_replace(coalesce(nullif(person.phone_normalized,''),person.phone,''),'[^0-9]','','g');
   due:=c.run_at+make_interval(secs=>idx*c.interval_seconds+(idx/c.block_size)*c.block_pause_seconds);
   if phone !~ '^\+[1-9][0-9]{7,14}$' or due>=c.expires_at or (rec->>'permission_expires_at')::timestamptz<=c.expires_at or length(btrim(coalesce(rec->>'evidence',''))) not between 5 and 1000 then raise exception 'Invalid destination, schedule or permission' using errcode='22023'; end if;
   insert into public.multichannel_jobs(account_id,mode,channel,line_key,contact_id,purpose,recipient,body,dedup_key,run_at,expires_at,campaign_id,campaign_permission,permission_expires_at,permission_evidence,campaign_sequence)
    values(p_account_id,'whatsapp_live','whatsapp_support',c.routes->0->>'line_key',person.id,c.purpose,phone,c.body,'campaign:'||c.id::text||':'||person.id::text,due,c.expires_at,c.id,true,(rec->>'permission_expires_at')::timestamptz,rec->>'evidence',idx);
   idx:=idx+1;
  end loop;
  return jsonb_build_object('id',c.id,'status',c.status,'jobs',idx,'review_hash',c.review_hash,'duplicate',false);
 end if;
 select * into c from public.multichannel_campaigns where account_id=p_account_id and id=(p_payload->>'campaign_id')::uuid for update;
 if not found then return null; end if;
 if p_action='activate' then
  if c.status<>'draft' or c.review_hash is distinct from p_payload->>'review_hash' or c.expires_at<=tick then raise exception 'Campaign review required' using errcode='22023'; end if;
  update public.multichannel_campaigns set status='active',updated_at=tick where id=c.id returning * into c;
 elsif p_action='pause' and c.status in('active','paused') then
  update public.multichannel_campaigns set status=case when (p_payload->>'value')::boolean then 'paused' else 'active' end,updated_at=tick where id=c.id returning * into c;
 elsif p_action='cancel' then
  update public.multichannel_campaigns set status='cancelled',updated_at=tick where id=c.id returning * into c;
  update public.multichannel_jobs set status='cancelled',finished_at=tick,worker_id=null,claim_token=null,lease_until=null where account_id=p_account_id and campaign_id=c.id and status in('queued','claimed') and started_at is null;
 else raise exception 'Invalid campaign transition' using errcode='22023'; end if;
 return jsonb_build_object('id',c.id,'status',c.status);
end;
$$;
revoke all on function public.multichannel_campaign_control(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.multichannel_campaign_control(uuid,uuid,text,jsonb) to service_role;

-- A pause before start also fences SMS fallback jobs handled by the existing
-- SMS worker; already-started outcomes remain subject to reconciliation.
create function public.multichannel_campaign_start_guard() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.campaign_id is not null and new.status='dispatching' and old.status='claimed' and not exists(select 1 from public.multichannel_campaigns where id=new.campaign_id and account_id=new.account_id and status='active' and expires_at>clock_timestamp()) then raise exception 'Campaign paused' using errcode='42501'; end if;
 return new;
end;
$$;
create trigger multichannel_campaign_start_guard before update on public.multichannel_jobs for each row execute function public.multichannel_campaign_start_guard();

create function public.multichannel_campaign_worker_step(p_worker_id uuid,p_line_key text,p_action text,p_job_id uuid default null,p_claim_token uuid default null,p_ready boolean default null,p_session_phone text default null,p_state text default null,p_provider_id text default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare w public.multichannel_workers; l public.multichannel_whatsapp_session_lines; j public.multichannel_jobs; c public.multichannel_campaigns; chosen text; sms text; tick timestamptz:=clock_timestamp(); allowed boolean; conversation uuid; message uuid;
begin
 select * into w from public.multichannel_workers where id=p_worker_id and enabled;
 if not found then raise exception 'Worker unavailable' using errcode='42501'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(w.account_id::text,0));
 select * into l from public.multichannel_whatsapp_session_lines where account_id=w.account_id and line_key=p_line_key and worker_id=w.id for update;
 if not found or l.linked_phone is distinct from p_session_phone then raise exception 'Line identity mismatch' using errcode='42501'; end if;
 if p_action='heartbeat' then
  update public.multichannel_whatsapp_session_lines set campaign_ready_at=case when p_ready then tick else null end where account_id=w.account_id and line_key=p_line_key;
  return jsonb_build_object('recorded',true);
 end if;
 if p_action='claim' then
  update public.multichannel_campaigns ca set status='completed',updated_at=tick where ca.account_id=w.account_id and ca.status='active' and exists(select 1 from public.multichannel_jobs q where q.campaign_id=ca.id) and not exists(select 1 from public.multichannel_jobs q where q.campaign_id=ca.id and q.status not in('delivered','failed','cancelled','expired'));
  update public.multichannel_jobs set status=case when status='dispatching' then 'needs_review' else 'queued' end,finished_at=case when status='dispatching' then tick else null end,worker_id=null,claim_token=null,lease_until=null
   where account_id=w.account_id and mode='whatsapp_live' and status in('claimed','dispatching') and lease_until<=tick;
  update public.multichannel_jobs set status='expired',finished_at=tick where account_id=w.account_id and mode='whatsapp_live' and status='queued' and expires_at<=tick;
  if exists(select 1 from public.multichannel_jobs where worker_id=w.id and line_key=p_line_key and status in('claimed','dispatching')) then return null; end if;
  for j in select q.* from public.multichannel_jobs q join public.multichannel_campaigns ca on ca.id=q.campaign_id and ca.account_id=q.account_id where q.account_id=w.account_id and q.mode='whatsapp_live' and q.status='queued' and q.run_at<=tick and q.expires_at>tick and ca.status='active' order by (q.routing_alert is null) desc,q.run_at,q.id for update of q skip locked limit 100 loop
   select * into c from public.multichannel_campaigns where id=j.campaign_id;
   if exists(select 1 from public.multichannel_jobs earlier where earlier.campaign_id=j.campaign_id and earlier.campaign_sequence<j.campaign_sequence and earlier.status in('queued','claimed','dispatching')) then continue; end if;
   if j.campaign_sequence>0 and mod(j.campaign_sequence,c.block_size)=0 and exists(select 1 from public.multichannel_jobs earlier where earlier.campaign_id=j.campaign_id and earlier.campaign_sequence<j.campaign_sequence and earlier.started_at>tick-make_interval(secs=>c.block_pause_seconds)) then continue; end if;
   select route->>'line_key' into chosen from jsonb_array_elements(c.routes) with ordinality as r(route,position)
    join public.multichannel_whatsapp_session_lines sl on sl.account_id=w.account_id and sl.line_key=route->>'line_key'
    join public.multichannel_workers sw on sw.account_id=sl.account_id and sw.id=sl.worker_id and sw.enabled
    where route->>'channel'='whatsapp_support' and not sl.paused and sl.campaign_ready_at>=tick-interval '30 seconds' order by position limit 1;
   if chosen is null then
    select route->>'line_key' into sms from jsonb_array_elements(c.routes) route where route->>'channel'='sms' limit 1;
    if sms is not null and exists(select 1 from public.multichannel_sms_authorizations a join public.multichannel_lines sl on sl.account_id=a.account_id and sl.line_key=sms where a.account_id=w.account_id and a.contact_id=j.contact_id and a.purpose=j.purpose and a.recipient=j.recipient and a.granted and a.expires_at>tick and not sl.paused and sl.available)
      and exists(select 1 from public.multichannel_sms_bindings sb join public.multichannel_workers sw on sw.id=sb.worker_id and sw.account_id=sb.account_id where sb.account_id=w.account_id and sb.line_key=sms and sb.enabled and sw.enabled and sb.ready_at>=tick-interval '90 seconds') then
     insert into public.multichannel_jobs(account_id,mode,channel,line_key,contact_id,purpose,recipient,body,dedup_key,run_at,expires_at,campaign_id,campaign_sequence)
      values(j.account_id,'sms_live','sms',sms,j.contact_id,j.purpose,j.recipient,j.body,j.dedup_key||':sms',greatest(j.run_at,tick),j.expires_at,j.campaign_id,j.campaign_sequence) on conflict(account_id,dedup_key) do nothing;
     update public.multichannel_jobs set status='cancelled',routing_alert='routed_to_sms',finished_at=tick where id=j.id;
    else update public.multichannel_jobs set routing_alert='no_available_authorized_line' where id=j.id; end if;
    continue;
   end if;
   if chosen<>p_line_key then continue; end if;
   if exists(select 1 from public.multichannel_jobs where account_id=w.account_id and line_key=chosen and status in('claimed','dispatching')) then return null; end if;
   if exists(select 1 from public.multichannel_jobs where account_id=w.account_id and mode='whatsapp_live' and line_key=chosen and started_at>tick-make_interval(secs=>c.interval_seconds)) then return null; end if;
   update public.multichannel_jobs set line_key=chosen,status='claimed',worker_id=w.id,last_worker_id=w.id,claim_token=gen_random_uuid(),lease_until=tick+interval '2 minutes',routing_alert=null where id=j.id returning * into j;
   return to_jsonb(j);
  end loop;
  return null;
 end if;
 if p_action='ack' then
  select * into j from public.multichannel_jobs where id=p_job_id and account_id=w.account_id and mode='whatsapp_live' and last_worker_id=w.id and line_key=p_line_key and provider_id=p_provider_id and status in('accepted','sent','delivered') for update;
  if not found or p_state<>'delivered' then return null; end if;
  update public.multichannel_jobs set status='delivered',provider_state='delivered',finished_at=coalesce(finished_at,tick) where id=j.id;
  update public.messages set status='delivered' where id=j.campaign_message_row_id;
  return jsonb_build_object('recorded',true);
 end if;
 select * into j from public.multichannel_jobs where id=p_job_id and account_id=w.account_id and mode='whatsapp_live' and worker_id=w.id and line_key=p_line_key for update;
 if not found or j.claim_token is distinct from p_claim_token or j.lease_until<=tick then return null; end if;
 if p_action='authorize' and j.status in('claimed','dispatching') then
  select * into c from public.multichannel_campaigns where id=j.campaign_id and account_id=w.account_id;
  allowed:=c.status='active' and c.expires_at>tick and not l.paused and l.campaign_ready_at>=tick-interval '30 seconds'
   and j.campaign_permission and j.permission_expires_at>tick
   and exists(select 1 from public.contacts ct where ct.id=j.contact_id and ct.account_id=j.account_id and '+'||regexp_replace(coalesce(nullif(ct.phone_normalized,''),ct.phone,''),'[^0-9]','','g')=j.recipient)
   and exists(select 1 from public.profiles where user_id=c.created_by and account_id=w.account_id and account_role='owner')
   and not exists(select 1 from public.conversations co where co.account_id=j.account_id and co.contact_id=j.contact_id and co.last_human_message_at>tick-interval '5 minutes');
  if allowed is distinct from true then
   update public.multichannel_jobs set status=case when j.status='dispatching' then 'cancelled' else 'queued' end,finished_at=case when j.status='dispatching' then tick else null end,worker_id=null,claim_token=null,lease_until=null,routing_alert='permission_or_pause' where id=j.id;
   if j.status='dispatching' then update public.messages set status='failed' where id=j.campaign_message_row_id; end if;
   return jsonb_build_object('allowed',false);
  end if;
  if j.status='claimed' then
   insert into public.conversations(account_id,user_id,contact_id,automation_enabled,ai_enabled,ai_autoreply_disabled)
    values(j.account_id,c.created_by,j.contact_id,true,true,false) on conflict do nothing;
   select id into conversation from public.conversations where account_id=j.account_id and contact_id=j.contact_id;
   if conversation is null then raise exception 'Conversation unavailable'; end if;
   insert into public.messages(conversation_id,sender_type,content_type,content_text,message_id,status,created_at,whatsapp_session_line_key)
    values(conversation,'bot','text',j.body,'campaign-job:'||j.id::text,'sending',tick,p_line_key) returning id into message;
   update public.multichannel_jobs set status='dispatching',started_at=tick,attempts=attempts+1,campaign_conversation_id=conversation,campaign_message_row_id=message where id=j.id returning * into j;
  end if;
  return jsonb_build_object('allowed',true,'account_id',j.account_id,'line_key',j.line_key,'session_phone',l.linked_phone,'job_id',j.id,'campaign_id',j.campaign_id,'chat_id',substring(j.recipient from 2)||'@c.us','body',j.body,'expires_at',tick+interval '20 seconds');
 elsif p_action='record' and j.status='dispatching' then
  if p_state not in('accepted','delivered','needs_review','failed') or(p_state in('accepted','delivered') and (p_provider_id is null or length(p_provider_id) not between 1 and 1024)) then raise exception 'Invalid result' using errcode='22023'; end if;
  update public.multichannel_jobs set status=p_state,provider_id=p_provider_id,provider_state=case when p_state in('accepted','delivered','failed') then p_state else null end,finished_at=tick,worker_id=null,claim_token=null,lease_until=null where id=j.id;
  update public.messages set message_id=case when p_state in('accepted','delivered') then p_provider_id else message_id end,status=case when p_state='accepted' then 'sent' when p_state='delivered' then 'delivered' when p_state='failed' then 'failed' else 'sending' end where id=j.campaign_message_row_id;
  update public.conversations set last_message_text=j.body,last_message_at=tick,updated_at=tick where id=j.campaign_conversation_id;
  return jsonb_build_object('recorded',true);
 elsif p_action='release' and j.status='claimed' then
  update public.multichannel_jobs set status='queued',worker_id=null,claim_token=null,lease_until=null where id=j.id;
  return jsonb_build_object('recorded',true);
 end if;
 return null;
end;
$$;
revoke all on function public.multichannel_campaign_worker_step(uuid,text,text,uuid,uuid,boolean,text,text,text) from public,anon,authenticated;
grant execute on function public.multichannel_campaign_worker_step(uuid,text,text,uuid,uuid,boolean,text,text,text) to service_role;
