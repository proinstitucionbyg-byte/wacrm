-- LOCAL ONLY until the owner authorizes production. Historical rows stay NULL.
alter table public.automation_logs add column if not exists inbound_message_id text;
create unique index if not exists automation_logs_inbound_execution_key
  on public.automation_logs(account_id, automation_id, inbound_message_id)
  where inbound_message_id is not null;
comment on column public.automation_logs.inbound_message_id is
  'Server-provided provider inbound identity; unique per account and automation to claim before side effects.';
