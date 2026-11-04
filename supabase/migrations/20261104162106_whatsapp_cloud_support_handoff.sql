-- Owner-configured first-contact routing. Cloud source evidence is retained;
-- no synthetic WhatsApp Web inbound receipt is created.
alter table public.multichannel_whatsapp_session_lines add column support_ready_at timestamptz;
create table public.whatsapp_support_routes (
 account_id uuid primary key references public.accounts(id) on delete cascade,
 enabled boolean not null default false,
 line_order text[] not null check(cardinality(line_order) between 1 and 20),
 updated_at timestamptz not null default now()
);
alter table public.whatsapp_support_routes enable row level security;
revoke all on public.whatsapp_support_routes from public,anon,authenticated;
grant select,insert,update,delete on public.whatsapp_support_routes to service_role;
alter table public.whatsapp_session_outbound_jobs add column cloud_support_source_id uuid references public.messages(id);
create unique index whatsapp_cloud_support_one_source on public.whatsapp_session_outbound_jobs(cloud_support_source_id) where cloud_support_source_id is not null;

create function public.enqueue_cloud_support_opening(p_account_id uuid,p_conversation_id uuid,p_provider_id text,p_body text,p_options jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare source public.messages; conv public.conversations; target public.contacts; selected public.multichannel_whatsapp_session_lines;
 job public.whatsapp_session_outbound_jobs; msg uuid; chat text; tick timestamptz:=clock_timestamp(); route public.whatsapp_support_routes;
begin
 select * into route from public.whatsapp_support_routes where account_id=p_account_id and enabled;
 if not found then return jsonb_build_object('handled',false);end if;
 if p_body is null or length(btrim(p_body)) not between 1 and 4000 or jsonb_typeof(p_options) is distinct from 'array' or jsonb_array_length(p_options)>10 then raise exception 'Invalid support opening';end if;
 if exists(select 1 from jsonb_array_elements(p_options) o where jsonb_typeof(o->'id') is distinct from 'string' or length(o->>'id') not between 1 and 256 or jsonb_typeof(o->'title') is distinct from 'string' or length(o->>'title') not between 1 and 80) then raise exception 'Invalid support menu';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_account_id::text||':support:'||p_conversation_id::text,0));
 select * into conv from public.conversations where id=p_conversation_id and account_id=p_account_id for update;
 if not found then raise exception 'Conversation unavailable' using errcode='42501';end if;
 select * into source from public.messages where conversation_id=conv.id and message_id=p_provider_id and sender_type='customer' and whatsapp_session_line_key is null;
 if not found then raise exception 'Cloud source unavailable' using errcode='42501';end if;
 -- A later campaign message without a referral is still part of its original campaign.
 if nullif(conv.first_ad_referral->>'ctwa_clid','') is not null or (lower(conv.first_ad_referral->>'source_type')='ad' and coalesce(conv.first_ad_referral->>'source_id',conv.first_ad_referral->>'ad_id','')<>'')
 or nullif(source.source_referral->>'ctwa_clid','') is not null or (lower(source.source_referral->>'source_type')='ad' and coalesce(source.source_referral->>'source_id',source.source_referral->>'ad_id','')<>'') then return jsonb_build_object('handled',false);end if;
 if source.created_at<tick-interval '24 hours' then return jsonb_build_object('handled',true,'state','expired');end if;
 select * into job from public.whatsapp_session_outbound_jobs where account_id=p_account_id and conversation_id=conv.id and cloud_support_source_id is not null and (cloud_support_source_id=source.id or (created_at>tick-interval '10 minutes' and status not in ('failed','cancelled'))) order by created_at desc limit 1;
 if found then return jsonb_build_object('handled',true,'state',job.status,'job_id',job.id,'duplicate',true);end if;
 if conv.last_human_message_at>tick-interval '5 minutes' then return jsonb_build_object('handled',true,'state','human_active');end if;
 select l.* into selected from public.multichannel_whatsapp_session_lines l join public.multichannel_workers w on w.id=l.worker_id and w.account_id=l.account_id
 where l.account_id=p_account_id and l.line_key=any(route.line_order) and not l.paused and w.enabled and l.support_ready_at>tick-interval '20 seconds'
 order by array_position(route.line_order,l.line_key) limit 1 for share of l,w;
 if not found then return jsonb_build_object('handled',true,'state','no_ready_line');end if;
 select * into target from public.contacts where id=conv.contact_id and account_id=p_account_id;
 chat:=regexp_replace(coalesce(nullif(target.phone_normalized,''),target.phone,''),'[^0-9]','','g');
 if chat!~'^[1-9][0-9]{6,14}$' then return jsonb_build_object('handled',true,'state','phone_required');end if;
 if exists(select 1 from public.multichannel_whatsapp_session_lines where account_id=p_account_id and linked_phone=chat and not paused) then return jsonb_build_object('handled',true,'state','internal_line');end if;
 insert into public.messages(conversation_id,sender_type,content_type,content_text,message_id,status,created_at,whatsapp_session_line_key,interactive_payload)
 values(conv.id,'bot','text',p_body,'waweb-pending:'||gen_random_uuid()::text,'sending',tick,selected.line_key,
 case when jsonb_array_length(p_options)>0 then jsonb_build_object('kind','session_text_menu','options',p_options,'expires_at',tick+interval '24 hours') else null end) returning id into msg;
 insert into public.whatsapp_session_outbound_jobs(account_id,line_key,worker_id,conversation_id,message_row_id,inbound_provider_message_id,chat_id,body,dedup_key,cloud_support_source_id)
 values(p_account_id,selected.line_key,selected.worker_id,conv.id,msg,source.message_id,chat||'@c.us',p_body,'cloud-support:'||source.id::text,source.id) returning * into job;
 update public.messages set message_id='waweb-job:'||job.id::text where id=msg;
 -- The owner explicitly enables the support bot for non-campaign students;
 -- a currently active adviser above is never displaced.
 update public.conversations set automation_enabled=true,ai_enabled=true,ai_autoreply_disabled=false,last_message_text=p_body,last_message_at=tick,updated_at=tick where id=conv.id and account_id=p_account_id;
 return jsonb_build_object('handled',true,'state','queued','job_id',job.id,'line_key',selected.line_key);
end;$$;
revoke all on function public.enqueue_cloud_support_opening(uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.enqueue_cloud_support_opening(uuid,uuid,text,text,jsonb) to service_role;

-- Preserve the original queue implementation for ordinary session replies.
alter function public.whatsapp_session_outbound_step(uuid,text,text,uuid,uuid,text,text) rename to whatsapp_session_outbound_step_before_support;
create function public.whatsapp_session_outbound_step(p_worker_id uuid,p_line_key text,p_action text,p_job_id uuid default null,p_claim_token uuid default null,p_state text default null,p_provider_message_id text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare job public.whatsapp_session_outbound_jobs; worker public.multichannel_workers; line public.multichannel_whatsapp_session_lines; tick timestamptz:=clock_timestamp();result jsonb;
begin
 if p_action='ack' then
  select * into worker from public.multichannel_workers where id=p_worker_id and enabled;
  if not found then raise exception 'Worker unavailable' using errcode='42501';end if;
  select * into job from public.whatsapp_session_outbound_jobs where id=p_job_id and account_id=worker.account_id and worker_id=worker.id and line_key=p_line_key for update;
  if not found or job.status not in ('accepted','delivered','read') or p_state not in ('delivered','read') or p_provider_message_id is distinct from job.provider_message_id then return null;end if;
  update public.whatsapp_session_outbound_jobs set status=case when status='read' or p_state='read' then 'read' else 'delivered' end,finished_at=clock_timestamp() where id=job.id returning * into job;
  update public.messages set status=job.status where id=job.message_row_id;
  return jsonb_build_object('recorded',true,'status',job.status,'message_id',job.provider_message_id);
 end if;
 if p_action='claim' then
  select * into worker from public.multichannel_workers where id=p_worker_id and enabled;
  if not found then raise exception 'Worker unavailable' using errcode='42501';end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(worker.account_id::text,0));
  -- One worker serves many lines. Expired reservations on a paused old line
  -- must not hold its global busy index forever. Dispatches stay uncertain.
  with expired as (
   update public.whatsapp_session_outbound_jobs j set
    status=case when j.status='dispatching' then 'needs_review' when exists(select 1 from public.multichannel_whatsapp_session_lines l where l.account_id=j.account_id and l.line_key=j.line_key and l.paused) then 'cancelled' else 'queued' end,
    claim_token=null,lease_until=null,finished_at=case when j.status='dispatching' or exists(select 1 from public.multichannel_whatsapp_session_lines l where l.account_id=j.account_id and l.line_key=j.line_key and l.paused) then tick else null end
   where j.account_id=worker.account_id and j.worker_id=worker.id and j.status in ('claimed','dispatching') and j.lease_until<=tick returning j.message_row_id,j.status
  ) update public.messages m set status='failed' from expired e where m.id=e.message_row_id and e.status='cancelled';
  if exists(select 1 from public.whatsapp_session_outbound_jobs where worker_id=worker.id and status in ('claimed','dispatching')) then return null;end if;
 end if;
 if p_action='authorize' then
  select * into job from public.whatsapp_session_outbound_jobs where id=p_job_id and cloud_support_source_id is not null;
  if found then
   select * into worker from public.multichannel_workers where id=p_worker_id and enabled;
   if not found or worker.account_id<>job.account_id or job.worker_id<>p_worker_id or job.line_key<>p_line_key then raise exception 'Worker unavailable' using errcode='42501';end if;
   perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(worker.account_id::text,0));
   select * into job from public.whatsapp_session_outbound_jobs where id=p_job_id for update;
   if job.status not in ('claimed','dispatching') or job.claim_token is distinct from p_claim_token or job.lease_until<=tick then return null;end if;
   select * into line from public.multichannel_whatsapp_session_lines where account_id=job.account_id and line_key=p_line_key and worker_id=p_worker_id and not paused and support_ready_at>tick-interval '20 seconds' for share;
   if not found or not exists(select 1 from public.messages s join public.conversations c on c.id=s.conversation_id where s.id=job.cloud_support_source_id and s.conversation_id=job.conversation_id and s.sender_type='customer' and s.whatsapp_session_line_key is null and s.message_id=job.inbound_provider_message_id and c.account_id=job.account_id and c.automation_enabled and (c.last_human_message_at is null or c.last_human_message_at<=tick-interval '5 minutes')) then
    update public.whatsapp_session_outbound_jobs set status='cancelled',finished_at=tick,claim_token=null,lease_until=null where id=job.id;
    update public.messages set status='failed' where id=job.message_row_id;
    return jsonb_build_object('allowed',false);
   end if;
   update public.whatsapp_session_outbound_jobs set status='dispatching',started_at=coalesce(started_at,tick),lease_until=tick+interval '2 minutes' where id=job.id returning * into job;
   return jsonb_build_object('allowed',true,'job_id',job.id,'account_id',job.account_id,'line_key',job.line_key,'session_phone',line.linked_phone,'chat_id',job.chat_id,'inbound_provider_message_id',job.inbound_provider_message_id,'body',job.body,'claim_token',job.claim_token,'inbound_source','cloud_support','expires_at',tick+interval '20 seconds');
  end if;
 end if;
 result:=public.whatsapp_session_outbound_step_before_support(p_worker_id,p_line_key,p_action,p_job_id,p_claim_token,p_state,p_provider_message_id);
 if p_action='authorize' and (result->>'allowed')::boolean then
  select * into job from public.whatsapp_session_outbound_jobs where id=p_job_id;
  result:=result||jsonb_build_object('sender_type',job.sender_type);
 end if;
 return result;
end;$$;
revoke all on function public.whatsapp_session_outbound_step(uuid,text,text,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.whatsapp_session_outbound_step(uuid,text,text,uuid,uuid,text,text) to service_role;
notify pgrst,'reload schema';
