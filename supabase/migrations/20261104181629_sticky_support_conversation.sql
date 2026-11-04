-- Preserve an explicit support handoff when later messages still arrive in Cloud.
alter table public.conversations add column whatsapp_support_line_key text;
alter table public.messages add column whatsapp_session_phone text;
create function public.stamp_whatsapp_session_phone() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.whatsapp_session_line_key is not null then
  select l.linked_phone into new.whatsapp_session_phone from public.multichannel_whatsapp_session_lines l
   join public.conversations c on c.account_id=l.account_id where c.id=new.conversation_id and l.line_key=new.whatsapp_session_line_key;
 end if;return new;
end;$$;
revoke all on function public.stamp_whatsapp_session_phone() from public,anon,authenticated;
grant execute on function public.stamp_whatsapp_session_phone() to service_role;
create trigger stamp_whatsapp_session_phone before insert on public.messages for each row execute function public.stamp_whatsapp_session_phone();
update public.messages m set whatsapp_session_phone=l.linked_phone from public.conversations c,public.multichannel_whatsapp_session_lines l
 where c.id=m.conversation_id and l.account_id=c.account_id and l.line_key=m.whatsapp_session_line_key;
update public.conversations c set whatsapp_support_line_key=(select j.line_key from public.whatsapp_session_outbound_jobs j
 where j.conversation_id=c.id and j.account_id=c.account_id and j.cloud_support_source_id is not null and j.status in ('accepted','delivered','read') order by j.created_at desc limit 1)
 where exists(select 1 from public.whatsapp_session_outbound_jobs j where j.conversation_id=c.id and j.account_id=c.account_id and j.cloud_support_source_id is not null and j.status in ('accepted','delivered','read'));
-- The first opening keeps its stable dedup_key; follow-up replies can share the real Cloud source.
drop index public.whatsapp_cloud_support_one_source;
create index whatsapp_cloud_support_source on public.whatsapp_session_outbound_jobs(cloud_support_source_id) where cloud_support_source_id is not null;
do $$declare definition text;begin
 definition:=pg_get_functiondef('public.enqueue_cloud_support_opening(uuid,uuid,text,text,jsonb)'::regprocedure);
 if position('set automation_enabled=true,ai_enabled=true' in definition)=0 then raise exception 'Unexpected support function';end if;
 definition:=replace(definition,'set automation_enabled=true,ai_enabled=true','set whatsapp_support_line_key=selected.line_key,automation_enabled=true,ai_enabled=true');execute definition;
 definition:=pg_get_functiondef('public.whatsapp_session_outbound_step(uuid,text,text,uuid,uuid,text,text)'::regprocedure);
 if position('and c.automation_enabled and (c.last_human_message_at is null or c.last_human_message_at<=tick-interval ''5 minutes'')' in definition)=0 then raise exception 'Unexpected support authorization';end if;
 definition:=replace(definition,'and c.automation_enabled and (c.last_human_message_at is null or c.last_human_message_at<=tick-interval ''5 minutes'')','and (job.sender_type=''agent'' or (c.automation_enabled and (c.last_human_message_at is null or c.last_human_message_at<=tick-interval ''5 minutes'')))');
 definition:=replace(definition,'''inbound_source'',''cloud_support'',''expires_at''','''sender_type'',job.sender_type,''inbound_source'',''cloud_support'',''expires_at''');execute definition;
end;$$;

create function public.enqueue_cloud_support_reply(p_account_id uuid,p_conversation_id uuid,p_line_key text,p_provider_id text,p_body text,p_dedup_key text,p_sender_id uuid default null,p_options jsonb default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare conv public.conversations; source public.messages; line public.multichannel_whatsapp_session_lines; target public.contacts; job public.whatsapp_session_outbound_jobs; msg public.messages; tick timestamptz:=clock_timestamp();chat text;
begin
 if p_body is null or length(btrim(p_body)) not between 1 and 4000 or p_dedup_key is null or length(p_dedup_key) not between 1 and 200 then raise exception 'Invalid support reply';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_account_id::text||':support-reply:'||p_conversation_id::text,0));
 select * into conv from public.conversations where id=p_conversation_id and account_id=p_account_id for update;
 if not found or conv.whatsapp_support_line_key is distinct from p_line_key then raise exception 'Support route unavailable' using errcode='42501';end if;
 if not exists(select 1 from public.whatsapp_support_routes where account_id=p_account_id and enabled and p_line_key=any(line_order)) then raise exception 'Support route disabled' using errcode='42501';end if;
 if p_sender_id is not null and not exists(select 1 from public.profiles where user_id=p_sender_id and account_id=p_account_id and account_role in ('owner','admin','agent')) then raise exception 'Sender unavailable' using errcode='42501';end if;
 select * into source from public.messages where conversation_id=conv.id and sender_type='customer' order by created_at desc,id desc limit 1;
 if not found or source.whatsapp_session_line_key is not null or source.message_id is distinct from p_provider_id then raise exception 'Cloud source changed' using errcode='42501';end if;
 if nullif(conv.first_ad_referral->>'ctwa_clid','') is not null or (lower(conv.first_ad_referral->>'source_type')='ad' and coalesce(conv.first_ad_referral->>'source_id',conv.first_ad_referral->>'ad_id','')<>'') or nullif(source.source_referral->>'ctwa_clid','') is not null or (lower(source.source_referral->>'source_type')='ad' and coalesce(source.source_referral->>'source_id',source.source_referral->>'ad_id','')<>'') then raise exception 'Campaign origin requires review' using errcode='42501';end if;
 select * into job from public.whatsapp_session_outbound_jobs where account_id=p_account_id and line_key=p_line_key and dedup_key=p_dedup_key;
 if found then select * into msg from public.messages where id=job.message_row_id;return jsonb_build_object('message_id',msg.message_id,'message_row_id',msg.id,'job_id',job.id,'duplicate',true);end if;
 select l.* into line from public.multichannel_whatsapp_session_lines l join public.multichannel_workers w on w.id=l.worker_id and w.account_id=l.account_id
 where l.account_id=p_account_id and l.line_key=p_line_key and not l.paused and w.enabled and l.support_ready_at>tick-interval '20 seconds' for share of l,w;
 if not found then raise exception 'Support line unavailable; no Cloud fallback' using errcode='42501';end if;
 if p_sender_id is null and (not conv.automation_enabled or conv.last_human_message_at>tick-interval '5 minutes') then raise exception 'Human attention active' using errcode='42501';end if;
 if p_options is not null and (jsonb_typeof(p_options) is distinct from 'array' or jsonb_array_length(p_options)>10) then raise exception 'Invalid menu';end if;
 if p_options is not null and exists(select 1 from jsonb_array_elements(p_options) o where jsonb_typeof(o->'id') is distinct from 'string' or length(o->>'id') not between 1 and 256 or jsonb_typeof(o->'title') is distinct from 'string' or length(o->>'title') not between 1 and 80) then raise exception 'Invalid menu';end if;
 select * into target from public.contacts where id=conv.contact_id and account_id=p_account_id;
 chat:=regexp_replace(coalesce(nullif(target.phone_normalized,''),target.phone,''),'[^0-9]','','g');
 if chat!~'^[1-9][0-9]{6,14}$' or exists(select 1 from public.multichannel_whatsapp_session_lines where account_id=p_account_id and linked_phone=chat and not paused) then raise exception 'Recipient requires review';end if;
 insert into public.messages(conversation_id,sender_type,sender_id,content_type,content_text,message_id,status,created_at,whatsapp_session_line_key,interactive_payload)
 values(conv.id,case when p_sender_id is null then 'bot' else 'agent' end,p_sender_id,'text',btrim(p_body),'waweb-pending:'||gen_random_uuid()::text,'sending',tick,line.line_key,
 case when p_options is not null then jsonb_build_object('kind','session_text_menu','options',p_options,'expires_at',tick+interval '24 hours') end) returning * into msg;
 insert into public.whatsapp_session_outbound_jobs(account_id,line_key,worker_id,conversation_id,message_row_id,sender_type,sender_id,inbound_provider_message_id,chat_id,body,dedup_key,cloud_support_source_id)
 values(p_account_id,line.line_key,line.worker_id,conv.id,msg.id,msg.sender_type,p_sender_id,source.message_id,chat||'@c.us',btrim(p_body),p_dedup_key,source.id) returning * into job;
 update public.messages set message_id='waweb-job:'||job.id::text where id=msg.id returning * into msg;
 update public.conversations set last_message_text=btrim(p_body),last_message_at=tick,updated_at=tick,
 ai_enabled=case when p_sender_id is null then ai_enabled else false end,automation_enabled=case when p_sender_id is null then automation_enabled else false end,
 automation_disabled_at=case when p_sender_id is null then automation_disabled_at else tick end,last_human_message_at=case when p_sender_id is null then last_human_message_at else tick end where id=conv.id;
 if p_sender_id is not null then update public.flow_runs set status='paused_by_agent',ended_at=tick,end_reason='agent_replied' where account_id=p_account_id and contact_id=conv.contact_id and status='active';end if;
 return jsonb_build_object('job_id',job.id,'message_id',msg.message_id,'message_row_id',msg.id,'duplicate',false);
end;$$;
revoke all on function public.enqueue_cloud_support_reply(uuid,uuid,text,text,text,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.enqueue_cloud_support_reply(uuid,uuid,text,text,text,text,uuid,jsonb) to service_role;
alter function public.enqueue_whatsapp_session_manual_text(uuid,uuid,text,uuid,text,text) rename to enqueue_whatsapp_session_manual_text_before_sticky;
create function public.enqueue_whatsapp_session_manual_text(p_account_id uuid,p_conversation_id uuid,p_line_key text,p_sender_id uuid,p_body text,p_dedup_key text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare source public.messages;
begin
 select * into source from public.messages where conversation_id=p_conversation_id and sender_type='customer' order by created_at desc,id desc limit 1;
 if source.whatsapp_session_line_key is null and exists(select 1 from public.conversations where id=p_conversation_id and account_id=p_account_id and whatsapp_support_line_key=p_line_key) then
  return public.enqueue_cloud_support_reply(p_account_id,p_conversation_id,p_line_key,source.message_id,p_body,p_dedup_key,p_sender_id,null);
 end if;
 return public.enqueue_whatsapp_session_manual_text_before_sticky(p_account_id,p_conversation_id,p_line_key,p_sender_id,p_body,p_dedup_key);
end;$$;
revoke all on function public.enqueue_whatsapp_session_manual_text(uuid,uuid,text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.enqueue_whatsapp_session_manual_text(uuid,uuid,text,uuid,text,text) to service_role;
notify pgrst,'reload schema';
