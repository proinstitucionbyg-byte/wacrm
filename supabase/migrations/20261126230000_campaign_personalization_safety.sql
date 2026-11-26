begin;
alter table public.multichannel_campaigns add column recipient_variables jsonb not null default '{}'::jsonb check(jsonb_typeof(recipient_variables)='object');
alter table public.multichannel_jobs add column campaign_sms_body text;
alter table public.multichannel_whatsapp_session_lines add column campaign_restricted boolean not null default false;

create function public.render_campaign_variables(template text, vars jsonb) returns text language plpgsql immutable security invoker set search_path='' as $$
declare item text[];key text;result text:='';remaining text:=template;offset_n integer;
begin
 loop
  item:=regexp_match(remaining,'(\{\{\s*([^{}]+?)\s*\}\}|\[([^\[\]\r\n]+)\])');
  exit when item is null;
  key:=regexp_replace(lower(translate(btrim(coalesce(item[2],item[3])),'áéíóúüñÁÉÍÓÚÜÑ','aeiouunAEIOUUN')),'\s+','_','g');
  if not vars ? key or length(btrim(coalesce(vars->>key,'')))=0 then raise exception 'Missing campaign variable: %',key using errcode='22023';end if;
  offset_n:=position(item[1] in remaining);
  result:=result||substring(remaining from 1 for offset_n-1)||(vars->>key);
  remaining:=substring(remaining from offset_n+length(item[1]));
 end loop;
 result:=result||remaining;
 if length(btrim(result)) not between 1 and 4000 or position('{{' in result)>0 or position('}}' in result)>0 then raise exception 'Invalid personalized message' using errcode='22023';end if;
 return result;
end;$$;

create function public.personalize_campaign_jobs(p_account uuid,p_campaign uuid) returns void language plpgsql security invoker set search_path='' as $$
declare c public.multichannel_campaigns;j public.multichannel_jobs;vars jsonb;step jsonb;personal_media jsonb;
begin
 select * into strict c from public.multichannel_campaigns where id=p_campaign and account_id=p_account;
 for j in select * from public.multichannel_jobs where campaign_id=p_campaign and account_id=p_account and mode='whatsapp_live' and status='queued' and started_at is null and provider_id is null for update loop
  vars:=coalesce(c.recipient_variables->j.contact_id::text,'{}'::jsonb);
  step:=coalesce(c.sequence->coalesce(j.campaign_step,0),jsonb_build_object('body',c.body));
  personal_media:=step->'media';
  if personal_media ? 'caption' and length(personal_media->>'caption')>0 then personal_media:=jsonb_set(personal_media,'{caption}',to_jsonb(public.render_campaign_variables(personal_media->>'caption',vars)));end if;
  update public.multichannel_jobs set body=public.render_campaign_variables(step->>'body',vars),media=personal_media,campaign_sms_body=case when c.sms_body is not null then public.render_campaign_variables(c.sms_body,vars) end where id=j.id;
 end loop;
end;$$;

create function public.multichannel_campaign_control_personalized(p_account_id uuid,p_actor_id uuid,p_action text,p_payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;vars jsonb;
begin
 if p_action='activate' or (p_action='pause' and p_payload->>'value'='false') then
  if exists(select 1 from public.multichannel_campaigns c cross join lateral jsonb_array_elements(c.routes) r join public.multichannel_whatsapp_session_lines l on l.account_id=c.account_id and l.line_key=r->>'line_key' where c.account_id=p_account_id and c.id=(p_payload->>'campaign_id')::uuid and l.campaign_restricted) then raise exception 'Provider restriction requires review' using errcode='22023';end if;
 end if;
 result:=public.multichannel_campaign_control(p_account_id,p_actor_id,p_action,p_payload);
 if p_action='create' and not coalesce((result->>'duplicate')::boolean,false) then
  select coalesce(jsonb_object_agg(r->>'contact_id',coalesce(r->'variables','{}'::jsonb)),'{}'::jsonb) into vars from jsonb_array_elements(p_payload->'recipients') r;
  update public.multichannel_campaigns set recipient_variables=vars where id=(result->>'id')::uuid and account_id=p_account_id;
  perform public.personalize_campaign_jobs(p_account_id,(result->>'id')::uuid);
 end if;
 return result;
end;$$;

create function public.edit_pending_campaign_content_personalized(p_account uuid,p_actor uuid,p_campaign uuid,p_expected_hash text,p_name text,p_sequence jsonb,p_new_hash text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 result:=public.edit_pending_campaign_content(p_account,p_actor,p_campaign,p_expected_hash,p_name,p_sequence,p_new_hash);
 perform public.personalize_campaign_jobs(p_account,p_campaign);
 return result;
end;$$;

create function public.mark_campaign_recipient_handled(p_account uuid,p_actor uuid,p_job uuid) returns integer language plpgsql security invoker set search_path='' as $$
declare job public.multichannel_jobs;n integer;
begin
 if not exists(select 1 from public.profiles where account_id=p_account and user_id=p_actor and account_role='owner') then raise exception 'Owner required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_account::text,0));
 select * into strict job from public.multichannel_jobs where id=p_job and account_id=p_account and campaign_id is not null;
 update public.multichannel_jobs set status='cancelled',routing_alert='handled_manually',finished_at=clock_timestamp(),worker_id=null,claim_token=null,lease_until=null where account_id=p_account and campaign_id=job.campaign_id and contact_id=job.contact_id and status in('queued','claimed') and started_at is null;
 get diagnostics n=row_count;return n;
end;$$;

create function public.campaign_safety_sweep() returns jsonb language plpgsql security invoker set search_path='' as $$
declare tick timestamptz:=clock_timestamp();cancelled_n integer;paused_n integer;
begin
 update public.multichannel_jobs j set status='cancelled',routing_alert='handled_manually',finished_at=tick,worker_id=null,claim_token=null,lease_until=null
 from public.multichannel_campaigns c where j.campaign_id=c.id and j.account_id=c.account_id and j.status in('queued','claimed') and j.started_at is null
 and exists(select 1 from public.conversations co where co.account_id=j.account_id and co.contact_id=j.contact_id and co.last_human_message_at>=c.created_at);
 get diagnostics cancelled_n=row_count;
 update public.multichannel_campaigns c set status='paused',updated_at=tick where c.status='active' and c.run_at<=tick and c.created_at<tick-interval '60 seconds'
 and exists(select 1 from public.multichannel_jobs j where j.campaign_id=c.id and j.status='queued')
 and not exists(select 1 from jsonb_array_elements(c.routes) r join public.multichannel_whatsapp_session_lines l on l.account_id=c.account_id and l.line_key=r->>'line_key' join public.multichannel_workers w on w.id=l.worker_id and w.account_id=l.account_id and w.enabled where r->>'channel'='whatsapp_support' and not l.paused and not l.campaign_restricted and l.campaign_ready_at>=tick-interval '30 seconds');
 get diagnostics paused_n=row_count;
 update public.multichannel_jobs j set routing_alert='campaign_paused_no_available_line' from public.multichannel_campaigns c where c.id=j.campaign_id and c.account_id=j.account_id and c.status='paused' and c.updated_at=tick and j.status='queued';
 return jsonb_build_object('cancelled_manual',cancelled_n,'paused_no_lines',paused_n);
end;$$;

create function public.pause_restricted_campaigns(p_account uuid,p_line text) returns integer language plpgsql security invoker set search_path='' as $$
declare n integer;
begin
 update public.multichannel_campaigns c set status='paused',updated_at=clock_timestamp() where c.account_id=p_account and c.status='active' and exists(select 1 from jsonb_array_elements(c.routes) r where r->>'line_key'=p_line);
 get diagnostics n=row_count;
 update public.multichannel_jobs j set routing_alert='provider_restriction_review' from public.multichannel_campaigns c where c.id=j.campaign_id and c.account_id=p_account and c.status='paused' and j.status='queued' and exists(select 1 from jsonb_array_elements(c.routes) r where r->>'line_key'=p_line);
 return n;
end;$$;

create function public.multichannel_campaign_worker_step_safe(p_worker_id uuid,p_line_key text,p_action text,p_job_id uuid default null,p_claim_token uuid default null,p_ready boolean default null,p_session_phone text default null,p_state text default null,p_provider_id text default null,p_restricted boolean default false) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;account uuid;restricted_line text;
begin
 select account_id into account from public.multichannel_workers where id=p_worker_id and enabled;
 if account is null then raise exception 'Worker unavailable' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(account::text,0));
 if p_action='claim' then
  for restricted_line in select line_key from public.multichannel_whatsapp_session_lines where account_id=account and campaign_restricted loop perform public.pause_restricted_campaigns(account,restricted_line);end loop;
 end if;
 result:=public.multichannel_campaign_worker_step(p_worker_id,p_line_key,p_action,p_job_id,p_claim_token,p_ready,p_session_phone,p_state,p_provider_id);
 if p_action='heartbeat' then
  update public.multichannel_whatsapp_session_lines set campaign_restricted=case when p_restricted then true when p_ready then false else campaign_restricted end where account_id=account and worker_id=p_worker_id and line_key=p_line_key;
  if p_restricted then perform public.pause_restricted_campaigns(account,p_line_key);end if;
 end if;
 return result;
end;$$;

-- Preserve the existing ownership, permission, deduplication and lease checks.
do $patch$ declare source text;old text;begin
 source:=pg_get_functiondef('public.multichannel_campaign_worker_step(uuid,text,text,uuid,uuid,boolean,text,text,text)'::regprocedure);
 old:='coalesce(c.sms_body,j.body)';
 if position(old in source)=0 then raise exception 'Inspect SMS fallback before personalization';end if;
 source:=replace(source,old,'coalesce(j.campaign_sms_body,c.sms_body,j.body)');
 old:='co.last_human_message_at>tick-interval ''5 minutes''';
 if position(old in source)=0 then raise exception 'Inspect manual contact guard';end if;
 source:=replace(source,old,'co.last_human_message_at>=c.created_at');
 -- Prefer the confirmed conversation line while it is available, then an authorized technical fallback.
 old:='(j.predecessor_id is null or sl.line_key=(select previous.line_key from public.multichannel_jobs previous where previous.id=j.predecessor_id and previous.account_id=j.account_id))';
 if position(old in source)=0 then raise exception 'Inspect sequence fallback before changing';end if;
 source:=replace(source,old,'true');
 old:='order by position limit 1';
 if position(old in source)=0 then raise exception 'Inspect route selection order';end if;
 source:=replace(source,old,'order by case when j.predecessor_id is not null and sl.line_key=(select previous.line_key from public.multichannel_jobs previous where previous.id=j.predecessor_id and previous.account_id=j.account_id) then 0 else 1 end,position limit 1');
 old:='q.predecessor_id is not null and exists(select 1 from public.multichannel_jobs p where p.id=q.predecessor_id and p.account_id=q.account_id and p.line_key=p_line_key)';
 if position(old in source)>0 then source:=replace(source,old,'q.predecessor_id is not null');end if;
 execute source;
end;$patch$;

revoke all on function public.render_campaign_variables(text,jsonb),public.personalize_campaign_jobs(uuid,uuid),public.multichannel_campaign_control_personalized(uuid,uuid,text,jsonb),public.edit_pending_campaign_content_personalized(uuid,uuid,uuid,text,text,jsonb,text),public.mark_campaign_recipient_handled(uuid,uuid,uuid),public.campaign_safety_sweep(),public.pause_restricted_campaigns(uuid,text) from public,anon,authenticated;
grant execute on function public.render_campaign_variables(text,jsonb),public.personalize_campaign_jobs(uuid,uuid),public.multichannel_campaign_control_personalized(uuid,uuid,text,jsonb),public.edit_pending_campaign_content_personalized(uuid,uuid,uuid,text,text,jsonb,text),public.mark_campaign_recipient_handled(uuid,uuid,uuid),public.campaign_safety_sweep(),public.pause_restricted_campaigns(uuid,text) to service_role;
revoke all on function public.multichannel_campaign_worker_step_safe(uuid,text,text,uuid,uuid,boolean,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.multichannel_campaign_worker_step_safe(uuid,text,text,uuid,uuid,boolean,text,text,text,boolean) to service_role;
notify pgrst,'reload schema';
commit;
