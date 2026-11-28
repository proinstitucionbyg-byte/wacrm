BEGIN;
DO $patch$
DECLARE definition text;needle text:='OR EXISTS(SELECT 1 FROM public.multichannel_whatsapp_session_lines WHERE account_id=p_account_id AND linked_phone=phone)';
BEGIN
 definition:=pg_get_functiondef('public.enqueue_whatsapp_session_manual_text(uuid,uuid,text,uuid,text,text)'::regprocedure);
 IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'Inspect manual recipient validation before changing';END IF;
 -- A historical session registration is not proof that a recipient is a live sender.
 -- Keep the direct self-send fence; all account, member, readiness and dedup checks remain.
 definition:=replace(definition,needle,'OR phone=line.linked_phone');
 EXECUTE definition;
END;$patch$;
NOTIFY pgrst,'reload schema';
COMMIT;
