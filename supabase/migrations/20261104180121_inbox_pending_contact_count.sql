-- Count contacts waiting for a real answer, independently of read/unread.
-- SECURITY INVOKER retains the caller's existing Inbox/message RLS.
create function public.inbox_pending_contact_count(p_account_id uuid)
returns bigint language sql stable security invoker set search_path='' as $$
 select count(distinct c.contact_id)
 from public.conversations c
 cross join lateral (
  select m.created_at from public.messages m
  where m.conversation_id=c.id and m.sender_type='customer'
   and (c.inbox_cleared_at is null or m.created_at>c.inbox_cleared_at)
  order by m.created_at desc,m.id desc limit 1
 ) incoming
 where c.account_id=p_account_id
 and public.has_member_permission((select auth.uid()),'inbox','view')
 and not exists (
  select 1 from public.messages answer
  where answer.conversation_id=c.id and answer.sender_type in ('agent','bot')
   and answer.status in ('sent','delivered','read')
   and answer.created_at>=incoming.created_at
 );
$$;
revoke all on function public.inbox_pending_contact_count(uuid) from public,anon;
grant execute on function public.inbox_pending_contact_count(uuid) to authenticated,service_role;
