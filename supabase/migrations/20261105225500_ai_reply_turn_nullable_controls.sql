create or replace function public.ai_reply_turn_is_current(p_account uuid,p_conversation uuid,p_token uuid)
returns boolean language sql stable set search_path=public as $$
select exists(select 1 from ai_reply_turns t join conversations c on c.id=t.conversation_id and c.account_id=t.account_id
where t.account_id=p_account and t.conversation_id=p_conversation and t.token=p_token and c.ai_enabled
 and not coalesce(c.ai_autoreply_disabled,false) and coalesce(c.last_human_message_at,'-infinity'::timestamptz)<t.claimed_at
 and t.inbound_id=(select m.id from messages m where m.conversation_id=c.id and m.sender_type='customer' order by m.created_at desc,m.id desc limit 1));
$$;
