-- A fixed closing message, never an AI response or a restart of a course.
create table public.sales_window_followups (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  inbound_id uuid not null references public.messages(id) on delete cascade,
  inbound_at timestamptz not null,
  automation_id uuid not null references public.automations(id) on delete cascade,
  step_id uuid not null,
  payload jsonb not null,
  status text not null default 'sending' check(status in ('sending','sent','review')),
  message_id text,
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique(conversation_id,inbound_id)
);
alter table public.sales_window_followups enable row level security;
revoke all on public.sales_window_followups from anon,authenticated;
grant all on public.sales_window_followups to service_role;

create index if not exists messages_latest_customer_window
  on public.messages(conversation_id,created_at desc,id desc) where sender_type='customer';

create function public.sales_window_followup_candidates(p_conversation uuid default null)
returns table(conversation_id uuid,account_id uuid,user_id uuid,contact_id uuid,
  inbound_id uuid,inbound_at timestamptz,inbound_text text,automation_id uuid,
  automation_name text,step_id uuid,payload jsonb)
language sql stable security invoker set search_path=public as $$
  select c.id,c.account_id,c.user_id,c.contact_id,m.id,m.created_at,m.content_text,
    a.id,a.name,s.id,s.step_config
  from conversations c
  join contacts co on co.id=c.contact_id and co.account_id=c.account_id
  left join profiles adviser on adviser.user_id=c.assigned_agent_id and adviser.account_id=c.account_id
  join lateral(select x.id,x.created_at,x.content_text from messages x
    where x.conversation_id=c.id and x.sender_type='customer'
    order by x.created_at desc,x.id desc limit 1)m on true
  -- The latest main-course execution wins, even if it is still unfinished.
  join lateral(select l.* from automation_logs l join automations owned on owned.id=l.automation_id
    where l.account_id=c.account_id and l.contact_id=c.contact_id
      and owned.account_id=c.account_id and owned.trigger_config @> '{"sales_window_close":true}'::jsonb
    order by l.created_at desc,l.id desc limit 1)run on true
  join automations a on a.id=run.automation_id and a.account_id=c.account_id and a.is_active
  join lateral(select x.* from automation_steps x where x.automation_id=a.id and x.parent_step_id is null
    order by x.position desc limit 1)s on true
  where (p_conversation is null or c.id=p_conversation)
    and c.automation_enabled and c.status<>'closed'
    and coalesce(co.channel,'whatsapp')='whatsapp'
    and coalesce(nullif(upper(c.ai_handoff_area),''),'VENTAS')='VENTAS'
    and coalesce(nullif(upper(adviser.area),''),'VENTAS')='VENTAS'
    and coalesce(c.last_human_message_at,'-infinity'::timestamptz)<now()-interval '10 minutes'
    and m.created_at<=now()-interval '23 hours' and m.created_at>now()-interval '24 hours'
    and run.status='success' and s.step_type='send_buttons'
    and exists(select 1 from jsonb_array_elements(run.steps_executed) e
      join messages delivered on delivered.conversation_id=c.id
        and delivered.message_id is not null and delivered.status<>'failed'
        and strpos(e->>'detail','('||delivered.message_id||')')>0
      where e->>'step_id'=s.id::text and e->>'status'='success')
    and not exists(select 1 from automation_pending_executions p
      where p.account_id=c.account_id and p.contact_id=c.contact_id and p.status in ('pending','running'))
    and not exists(select 1 from payment_reviews p where p.account_id=c.account_id and p.contact_id=c.contact_id)
    and not exists(select 1 from enrollment_drafts d where d.account_id=c.account_id and d.conversation_id=c.id)
    and not exists(select 1 from messages receipt where receipt.conversation_id=c.id
      and receipt.sender_type='customer' and receipt.image_analysis->>'category'='payment_receipt')
    and not exists(select 1 from automation_logs p join automations pay on pay.id=p.automation_id
      where p.account_id=c.account_id and p.contact_id=c.contact_id
        and (pay.name='YAPE O PLIN' or pay.trigger_config @> '{"payment_followup":true}'::jsonb))
    and not exists(select 1 from contact_tags ct join tags t on t.id=ct.tag_id where ct.contact_id=c.contact_id
      and (upper(t.name) like '%FIDELIZACION%' or upper(t.name) like '%MATRICUL%'
        or upper(t.name) in ('PAGO VALIDADO','PENDIENTE DE VALIDACION')))
    and not exists(select 1 from sales_window_followups f where f.conversation_id=c.id and f.inbound_id=m.id)
  order by m.created_at,c.id limit 100;
$$;

create function public.claim_sales_window_followup(p_conversation uuid,p_inbound uuid,p_step uuid)
returns table(id uuid,payload jsonb,inbound_at timestamptz)
language plpgsql security invoker set search_path=public as $$
begin
  perform 1 from conversations where conversations.id=p_conversation for update;
  return query insert into sales_window_followups as saved
    (account_id,conversation_id,inbound_id,inbound_at,automation_id,step_id,payload)
    select c.account_id,c.conversation_id,c.inbound_id,c.inbound_at,c.automation_id,c.step_id,c.payload
    from sales_window_followup_candidates(p_conversation)c
    where c.inbound_id=p_inbound and c.step_id=p_step
    on conflict(conversation_id,inbound_id) do nothing
    returning saved.id,saved.payload,saved.inbound_at;
end $$;
revoke all on function public.sales_window_followup_candidates(uuid) from public,anon,authenticated;
revoke all on function public.claim_sales_window_followup(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.sales_window_followup_candidates(uuid) to service_role;
grant execute on function public.claim_sales_window_followup(uuid,uuid,uuid) to service_role;

