-- Use the configured original flow at 23h30; never copy its text or media.
create or replace function public.sales_window_followup_candidates(p_conversation uuid default null)
returns table(conversation_id uuid,account_id uuid,user_id uuid,contact_id uuid,inbound_id uuid,inbound_at timestamptz,inbound_text text,automation_id uuid,automation_name text,step_id uuid,payload jsonb)
language sql stable set search_path=public as $$
select c.id,c.account_id,a.user_id,c.contact_id,m.id,m.created_at,m.content_text,a.id,a.name,s.id,s.step_config
from conversations c join contacts co on co.id=c.contact_id and co.account_id=c.account_id
join automations a on a.account_id=c.account_id and a.is_active and a.trigger_type='time_based'
 and a.trigger_config @> '{"internal_only":true,"sales_window_last_call":true}'::jsonb
join lateral(select x.* from automation_steps x where x.automation_id=a.id and x.parent_step_id is null order by position limit 1)s on true
join lateral(select x.* from messages x where x.conversation_id=c.id and x.sender_type='customer' order by created_at desc,id desc limit 1)m on true
where (p_conversation is null or c.id=p_conversation) and c.automation_enabled and c.status<>'closed'
 and coalesce(co.channel,'whatsapp')='whatsapp'
 and (upper(c.ai_handoff_area)='VENTAS' or exists(select 1 from contact_tags ct join tags t on t.id=ct.tag_id where ct.contact_id=c.contact_id and upper(t.name)='AREA VENTAS'))
 and coalesce(nullif(upper(c.ai_handoff_area),''),'VENTAS')='VENTAS'
 and coalesce(c.last_human_message_at,'-infinity'::timestamptz)<now()-interval '10 minutes'
 and m.created_at<=now()-interval '23 hours 30 minutes' and m.created_at>now()-interval '24 hours'
 and (select count(*) from automations ax where ax.account_id=c.account_id and ax.is_active and ax.trigger_config @> '{"sales_window_last_call":true}'::jsonb)=1
 and not exists(select 1 from payment_reviews p where p.account_id=c.account_id and p.contact_id=c.contact_id and p.status in ('pending','validated'))
 and not exists(select 1 from enrollment_drafts d where d.account_id=c.account_id and d.conversation_id=c.id)
 and not exists(select 1 from contact_tags ct join tags t on t.id=ct.tag_id where ct.contact_id=c.contact_id and (upper(t.name) like '%FIDELIZACION%' or upper(t.name) like '%MATRICUL%' or upper(t.name) in ('PAGO VALIDADO','PENDIENTE DE VALIDACION','NO INTERESADO','VENTA REALIZADA','NO CONTACTAR')))
 and not exists(select 1 from messages receipt where receipt.conversation_id=c.id and receipt.sender_type='customer' and receipt.image_analysis->>'category'='payment_receipt')
 and not exists(select 1 from sales_window_followups f where f.conversation_id=c.id and f.inbound_id=m.id)
order by m.created_at,c.id limit 100;
$$;
create or replace function public.claim_sales_window_followup(p_conversation uuid,p_inbound uuid,p_step uuid)
returns table(id uuid,payload jsonb,inbound_at timestamptz)
language plpgsql set search_path=public as $$
declare candidate record; reservation uuid; execution uuid;
begin
 perform 1 from conversations c where c.id=p_conversation for update;
 select * into candidate from sales_window_followup_candidates(p_conversation) c where c.inbound_id=p_inbound and c.step_id=p_step;
 if not found then return; end if;
 insert into sales_window_followups(account_id,conversation_id,inbound_id,inbound_at,automation_id,step_id,payload)
 values(candidate.account_id,candidate.conversation_id,candidate.inbound_id,candidate.inbound_at,candidate.automation_id,candidate.step_id,candidate.payload)
 on conflict(conversation_id,inbound_id) do nothing returning sales_window_followups.id into reservation;
 if reservation is null then return; end if;
 insert into automation_logs(automation_id,account_id,user_id,contact_id,trigger_event,steps_executed,status,inbound_message_id)
 values(candidate.automation_id,candidate.account_id,candidate.user_id,candidate.contact_id,'time_based:last_call_30_minutes','[]','partial','sales-window:'||reservation) returning automation_logs.id into execution;
 insert into automation_pending_executions(automation_id,account_id,user_id,contact_id,log_id,next_step_position,context,status,run_at)
 values(candidate.automation_id,candidate.account_id,candidate.user_id,candidate.contact_id,execution,0,
 jsonb_build_object('conversation_id',candidate.conversation_id,'inbound_at',candidate.inbound_at,'inbound_message_id','sales-window:'||reservation,'sales_window_followup_id',reservation),'pending',now());
 return query select reservation,candidate.payload,candidate.inbound_at;
end; $$;
create or replace function public.sales_window_followup_is_current(p_id uuid,p_account uuid,p_conversation uuid,p_automation uuid)
returns boolean language sql stable set search_path=public as $$
select exists(select 1 from sales_window_followups f join conversations c on c.id=f.conversation_id and c.account_id=f.account_id
join automations a on a.id=f.automation_id and a.account_id=f.account_id and a.is_active
where f.id=p_id and f.account_id=p_account and f.conversation_id=p_conversation and f.automation_id=p_automation
 and a.trigger_config @> '{"sales_window_last_call":true}'::jsonb and c.automation_enabled and c.status<>'closed'
 and now()>=f.inbound_at+interval '23 hours 30 minutes' and now()<f.inbound_at+interval '24 hours'
 and not exists(select 1 from messages m where m.conversation_id=c.id and m.sender_type='customer' and (m.created_at>f.inbound_at or (m.created_at=f.inbound_at and m.id>f.inbound_id)))
 and (upper(c.ai_handoff_area)='VENTAS' or exists(select 1 from contact_tags ct join tags t on t.id=ct.tag_id where ct.contact_id=c.contact_id and upper(t.name)='AREA VENTAS'))
 and coalesce(nullif(upper(c.ai_handoff_area),''),'VENTAS')='VENTAS'
 and coalesce(c.last_human_message_at,'-infinity'::timestamptz)<now()-interval '10 minutes'
 and not exists(select 1 from payment_reviews p where p.account_id=c.account_id and p.contact_id=c.contact_id and p.status in ('pending','validated'))
 and not exists(select 1 from enrollment_drafts d where d.account_id=c.account_id and d.conversation_id=c.id)
 and not exists(select 1 from contact_tags ct join tags t on t.id=ct.tag_id where ct.contact_id=c.contact_id and (upper(t.name) like '%FIDELIZACION%' or upper(t.name) like '%MATRICUL%' or upper(t.name) in ('PAGO VALIDADO','PENDIENTE DE VALIDACION','NO INTERESADO','VENTA REALIZADA','NO CONTACTAR')))
 and not exists(select 1 from messages m where m.conversation_id=c.id and m.sender_type='customer' and m.image_analysis->>'category'='payment_receipt'));
$$;
revoke all on function public.sales_window_followup_is_current(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.sales_window_followup_is_current(uuid,uuid,uuid,uuid) to service_role;
-- The editor no longer needs an artificial cron string for a relative window.
update automations set trigger_config=(trigger_config-'schedule')||'{"window_before_minutes":30}'::jsonb
where trigger_type='time_based' and trigger_config @> '{"internal_only":true,"sales_window_last_call":true}'::jsonb;
