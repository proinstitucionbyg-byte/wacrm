-- Invoker rights retain the existing conversation/message visibility policies.
CREATE OR REPLACE FUNCTION public.search_inbox_conversations(p_query text DEFAULT '', p_unread boolean DEFAULT false, p_offset integer DEFAULT 0)
RETURNS TABLE(conversation_id uuid, contact_match boolean)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = ''
AS $$
DECLARE q text:=btrim(p_query); digits text; literal text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_member_permission(auth.uid(),'inbox','view') THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501';
  END IF;
  IF length(q)>120 OR p_offset<0 OR (length(q)<2 AND NOT p_unread) THEN
    RAISE EXCEPTION 'Invalid search' USING ERRCODE='22023';
  END IF;
  IF q ~ '^[+0-9 ().-]+$' THEN
    digits:=regexp_replace(q,'[^0-9]','','g');
    IF digits ~ '^519[0-9]{8}$' THEN digits:=substring(digits FROM 3); END IF;
  END IF;
  literal:='%'||replace(replace(replace(q,E'\\',E'\\\\'),'%',E'\\%'),'_',E'\\_')||'%';
  RETURN QUERY
  SELECT c.id, (q='' OR ct.name ILIKE literal OR
    (digits IS NOT NULL AND regexp_replace(coalesce(ct.phone,''),'[^0-9]','','g') LIKE '%'||digits||'%')) AS direct
  FROM public.conversations c JOIN public.contacts ct ON ct.id=c.contact_id AND ct.account_id=c.account_id
  WHERE (NOT p_unread OR c.unread_count>0)
    AND (c.inbox_cleared_at IS NULL OR c.last_message_at>c.inbox_cleared_at)
    AND (q='' OR ct.name ILIKE literal OR
      (digits IS NOT NULL AND regexp_replace(coalesce(ct.phone,''),'[^0-9]','','g') LIKE '%'||digits||'%') OR
      EXISTS (SELECT 1 FROM public.messages m WHERE m.conversation_id=c.id
        AND (c.inbox_cleared_at IS NULL OR m.created_at>c.inbox_cleared_at)
        AND NOT EXISTS(SELECT 1 FROM public.inbox_hidden_messages h WHERE h.message_id=m.id)
        AND (CASE WHEN digits IS NOT NULL THEN regexp_replace(coalesce(m.content_text,''),'[^0-9]','','g') LIKE '%'||digits||'%'
          ELSE m.content_text ILIKE literal END)))
  ORDER BY direct DESC, c.last_message_at DESC NULLS LAST, c.id
  LIMIT 101 OFFSET p_offset;
END $$;
REVOKE ALL ON FUNCTION public.search_inbox_conversations(text,boolean,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.search_inbox_conversations(text,boolean,integer) TO authenticated;
