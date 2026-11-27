-- Reuse the verified, account-scoped visibility function for normal Inbox pages.
DO $migration$
DECLARE source text; old text:='(length(q)<2 AND NOT p_unread)';
BEGIN
 SELECT pg_get_functiondef('public.search_inbox_conversations(text,boolean,integer)'::regprocedure) INTO source;
 IF position(old in source)=0 THEN RAISE EXCEPTION 'Inspect Inbox query validation before enabling browse pages';END IF;
 EXECUTE replace(source,old,'(q<>'''' AND length(q)<2 AND NOT p_unread)');
END $migration$;
