create table public.ai_reply_turns (
 conversation_id uuid primary key references public.conversations(id) on delete cascade,
 account_id uuid not null references public.accounts(id) on delete cascade,
 inbound_id uuid not null references public.messages(id) on delete cascade,
 token uuid not null default gen_random_uuid(), claimed_at timestamptz not null default now()
);
alter table public.ai_reply_turns enable row level security;
revoke all on public.ai_reply_turns from public,anon,authenticated;
grant all on public.ai_reply_turns to service_role;
create function public.claim_ai_reply_turn(p_account uuid,p_conversation uuid)
returns table(token uuid) language plpgsql set search_path=public as $$
declare latest uuid;
begin
 perform 1 from conversations c where c.id=p_conversation and c.account_id=p_account and c.ai_enabled for update;
 if not found then return; end if;
 select m.id into latest from messages m where m.conversation_id=p_conversation and m.sender_type='customer' order by m.created_at desc,m.id desc limit 1;
 if latest is null then return; end if;
 return query insert into ai_reply_turns as t(conversation_id,account_id,inbound_id)
 values(p_conversation,p_account,latest)
 on conflict(conversation_id) do update set inbound_id=excluded.inbound_id,token=gen_random_uuid(),claimed_at=now()
 where t.account_id=p_account and t.inbound_id<>excluded.inbound_id returning t.token;
end; $$;
create function public.ai_reply_turn_is_current(p_account uuid,p_conversation uuid,p_token uuid)
returns boolean language sql stable set search_path=public as $$
select exists(select 1 from ai_reply_turns t join conversations c on c.id=t.conversation_id and c.account_id=t.account_id
where t.account_id=p_account and t.conversation_id=p_conversation and t.token=p_token and c.ai_enabled
 and not c.ai_autoreply_disabled and coalesce(c.last_human_message_at,'-infinity'::timestamptz)<t.claimed_at
 and t.inbound_id=(select m.id from messages m where m.conversation_id=c.id and m.sender_type='customer' order by m.created_at desc,m.id desc limit 1));
$$;
revoke all on function public.claim_ai_reply_turn(uuid,uuid) from public,anon,authenticated;
revoke all on function public.ai_reply_turn_is_current(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_ai_reply_turn(uuid,uuid) to service_role;
grant execute on function public.ai_reply_turn_is_current(uuid,uuid,uuid) to service_role;
