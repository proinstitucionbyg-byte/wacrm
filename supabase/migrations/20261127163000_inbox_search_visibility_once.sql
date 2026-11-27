-- Use the exact established visibility boundary and per-user hidden-message rules.
-- Search message text once, then check visibility only for matching conversations.
CREATE OR REPLACE FUNCTION public.search_inbox_conversations(p_query text DEFAULT '', p_unread boolean DEFAULT false, p_offset integer DEFAULT 0)
RETURNS TABLE(conversation_id uuid, contact_match boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' SET statement_timeout = '25s'
AS $$
DECLARE q text:=btrim(p_query); digits text; literal text; viewer_account uuid; viewer_role text; full_history boolean;
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_member_permission(auth.uid(),'inbox','view') THEN
   RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501';
 END IF;
 SELECT p.account_id,p.account_role::text INTO viewer_account,viewer_role FROM public.profiles p WHERE p.user_id=auth.uid();
 IF viewer_account IS NULL THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501';END IF;
 full_history:=viewer_role IN ('owner','admin') OR public.has_member_permission(auth.uid(),'inbox','supervise');
 IF length(q)>120 OR p_offset<0 OR (length(q)<2 AND NOT p_unread) THEN
   RAISE EXCEPTION 'Invalid search' USING ERRCODE='22023';
 END IF;
 IF q ~ '^[+0-9 ().-]+$' THEN
   digits:=nullif(regexp_replace(q,'[^0-9]','','g'),'');
   IF digits ~ '^519[0-9]{8}$' THEN digits:=substring(digits FROM 3); END IF;
 END IF;
 literal:='%'||replace(replace(replace(q,E'\\',E'\\\\'),'%',E'\\%'),'_',E'\\_')||'%';
 RETURN QUERY
 WITH message_hits AS MATERIALIZED (
   SELECT m.conversation_id,max(m.created_at) AS matched_at
   FROM public.messages m JOIN public.conversations c ON c.id=m.conversation_id AND c.account_id=viewer_account
   WHERE q<>'' AND (NOT p_unread OR c.unread_count>0)
     AND (c.inbox_cleared_at IS NULL OR m.created_at>c.inbox_cleared_at)
     AND NOT EXISTS(SELECT 1 FROM public.inbox_hidden_messages h WHERE h.message_id=m.id AND h.user_id=auth.uid())
     AND CASE WHEN digits IS NOT NULL THEN regexp_replace(coalesce(m.content_text,''),'[^0-9]','','g') LIKE '%'||digits||'%'
       ELSE m.content_text ILIKE literal END
   GROUP BY m.conversation_id
 ), candidates AS MATERIALIZED (
   SELECT c.id,c.last_message_at,c.inbox_cleared_at,h.matched_at,
     (q='' OR ct.name ILIKE literal OR (digits IS NOT NULL AND regexp_replace(coalesce(ct.phone,''),'[^0-9]','','g') LIKE '%'||digits||'%')) AS direct
   FROM public.conversations c JOIN public.contacts ct ON ct.id=c.contact_id AND ct.account_id=viewer_account
   LEFT JOIN message_hits h ON h.conversation_id=c.id
   WHERE c.account_id=viewer_account AND (NOT p_unread OR c.unread_count>0)
     AND (c.inbox_cleared_at IS NULL OR c.last_message_at>c.inbox_cleared_at)
     AND (q='' OR ct.name ILIKE literal OR (digits IS NOT NULL AND regexp_replace(coalesce(ct.phone,''),'[^0-9]','','g') LIKE '%'||digits||'%') OR h.conversation_id IS NOT NULL)
 ), permitted AS MATERIALIZED (
   SELECT c.*,CASE WHEN full_history THEN coalesce(c.inbox_cleared_at,'-infinity'::timestamptz)
     ELSE crm_private.inbox_visible_from(c.id) END AS boundary FROM candidates c
 )
 SELECT p.id,p.direct FROM permitted p
 WHERE p.boundary IS NOT NULL AND (p.direct OR p.matched_at>=p.boundary)
 ORDER BY p.direct DESC,p.last_message_at DESC NULLS LAST,p.id LIMIT 101 OFFSET p_offset;
END $$;
ALTER FUNCTION public.search_inbox_conversations(text,boolean,integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.search_inbox_conversations(text,boolean,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.search_inbox_conversations(text,boolean,integer) TO authenticated;
