begin;
alter table public.whatsapp_support_routes add column if not exists automatic_sales_handoff boolean not null default false;

-- Bind the existing history to the owner's configured Business line. This
-- prepares a route only: the original automation owns every message it sends.
create or replace function public.prepare_cloud_business_route(p_account_id uuid,p_conversation_id uuid,p_provider_id text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare conv public.conversations; source public.messages; route public.whatsapp_support_routes;
 selected public.multichannel_whatsapp_session_lines; tick timestamptz:=clock_timestamp();
begin
 select * into route from public.whatsapp_support_routes where account_id=p_account_id and enabled and automatic_sales_handoff;
 if not found then return jsonb_build_object('ready',false,'reason','route_not_enabled');end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_account_id::text||':support:'||p_conversation_id::text,0));
 select * into conv from public.conversations where id=p_conversation_id and account_id=p_account_id for update;
 if not found then raise exception 'Conversation unavailable' using errcode='42501';end if;
 if not conv.automation_enabled or conv.status='closed' or conv.last_human_message_at>tick-interval '5 minutes' then
  return jsonb_build_object('ready',false,'reason','human_or_closed');end if;
 select * into source from public.messages where conversation_id=conv.id and message_id=p_provider_id
  and sender_type='customer' and whatsapp_session_line_key is null;
 if not found or source.created_at<tick-interval '24 hours' then return jsonb_build_object('ready',false,'reason','source_unavailable');end if;
 if conv.whatsapp_support_line_key is not null then
  return jsonb_build_object('ready',true,'line_key',conv.whatsapp_support_line_key,'existing',true);end if;
 select l.* into selected from public.multichannel_whatsapp_session_lines l
 join public.multichannel_workers w on w.id=l.worker_id and w.account_id=l.account_id
 where l.account_id=p_account_id and l.line_key=any(route.line_order) and not l.paused and w.enabled
  and l.support_ready_at>tick-interval '20 seconds'
 order by array_position(route.line_order,l.line_key) limit 1 for share of l,w;
 if not found then return jsonb_build_object('ready',false,'reason','no_ready_line');end if;
 if exists(select 1 from public.contacts c where c.id=conv.contact_id and c.account_id=p_account_id
  and regexp_replace(coalesce(nullif(c.phone_normalized,''),c.phone,''),'[^0-9]','','g')=selected.linked_phone) then
  return jsonb_build_object('ready',false,'reason','internal_line');end if;
 update public.conversations set whatsapp_support_line_key=selected.line_key where id=conv.id and account_id=p_account_id;
 return jsonb_build_object('ready',true,'line_key',selected.line_key);
end;$$;
revoke all on function public.prepare_cloud_business_route(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.prepare_cloud_business_route(uuid,uuid,text) to service_role;

-- Retain campaign provenance and all original send guards. Only an account
-- with an explicitly enabled handoff may continue its automatic Business reply.
do $$declare definition text; guard text;begin
 definition:=pg_get_functiondef('public.enqueue_cloud_support_reply(uuid,uuid,text,text,text,text,uuid,jsonb)'::regprocedure);
 if position('automatic_sales_handoff' in definition)=0 then
  select substring(definition from 'if ([^\n]+) then raise exception ''Campaign origin requires review''') into guard;
  if guard is null then raise exception 'Campaign guard changed; no alteration applied';end if;
  definition:=replace(definition,'if '||guard||' then raise exception ''Campaign origin requires review''',
   'if not exists(select 1 from public.whatsapp_support_routes where account_id=p_account_id and enabled and automatic_sales_handoff) and ('||guard||') then raise exception ''Campaign origin requires review''');
  execute definition;
 end if;
end $$;
update public.whatsapp_support_routes set automatic_sales_handoff=true
 where account_id='4d761b3c-4c6c-4986-bcd8-d95f1754fe35' and enabled;
notify pgrst,'reload schema';
commit;
