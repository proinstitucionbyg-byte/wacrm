-- The canonical contact tag is the durable manual pause; automated handlers cannot clear it.
CREATE OR REPLACE FUNCTION crm_private.guard_indefinite_automatic_pause()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.contact_tags ct JOIN public.tags t ON t.id=ct.tag_id
   WHERE ct.contact_id=NEW.contact_id AND t.account_id=NEW.account_id AND t.name='DESACTIVADO AMBOS') THEN
   NEW.ai_enabled:=false; NEW.automation_enabled:=false; NEW.ai_autoreply_disabled:=true;
   NEW.ai_disabled_at:=NULL; NEW.automation_disabled_at:=NULL;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_indefinite_automatic_pause BEFORE INSERT OR UPDATE ON public.conversations
FOR EACH ROW EXECUTE FUNCTION crm_private.guard_indefinite_automatic_pause();

CREATE OR REPLACE FUNCTION crm_private.sync_indefinite_automatic_pause_tag()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE label public.tags; target uuid; paused boolean:=TG_OP='INSERT';
BEGIN
 SELECT * INTO label FROM public.tags WHERE id=CASE WHEN paused THEN NEW.tag_id ELSE OLD.tag_id END;
 IF NOT FOUND OR label.name<>'DESACTIVADO AMBOS' THEN RETURN NULL; END IF;
 target:=CASE WHEN paused THEN NEW.contact_id ELSE OLD.contact_id END;
 UPDATE public.conversations SET ai_enabled=NOT paused,automation_enabled=NOT paused,
   ai_autoreply_disabled=paused,ai_disabled_at=NULL,automation_disabled_at=NULL
 WHERE account_id=label.account_id AND contact_id=target;
 UPDATE public.automation_pending_executions e SET status=CASE WHEN paused THEN 'paused' ELSE 'pending' END
 FROM public.conversations c WHERE c.contact_id=target AND c.account_id=label.account_id
   AND e.account_id=c.account_id AND e.context->>'conversation_id'=c.id::text
   AND e.status=CASE WHEN paused THEN 'pending' ELSE 'paused' END;
 RETURN NULL;
END $$;
CREATE TRIGGER sync_indefinite_automatic_pause_tag AFTER INSERT OR DELETE ON public.contact_tags
FOR EACH ROW EXECUTE FUNCTION crm_private.sync_indefinite_automatic_pause_tag();

CREATE OR REPLACE FUNCTION public.set_conversation_automatic_pause(p_conversation uuid, p_paused boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_account uuid;
  v_member_account uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT account_id INTO v_account
  FROM public.conversations
  WHERE id = p_conversation
  FOR UPDATE;
  IF v_account IS NULL THEN RETURN false; END IF;

  SELECT account_id INTO v_member_account
  FROM public.profiles WHERE user_id = auth.uid();
  IF v_member_account IS DISTINCT FROM v_account
     OR NOT public.has_member_permission(auth.uid(), 'inbox', 'send') THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  IF crm_private.inbox_visible_from(p_conversation) IS NULL THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_account::text,17));
  IF p_paused THEN
    INSERT INTO public.tags(account_id,user_id,name,color,kind,audience)
    SELECT v_account,auth.uid(),'DESACTIVADO AMBOS','#64748b','process','{"users":[],"areas":[],"roles":[]}'::jsonb
    WHERE NOT EXISTS(SELECT 1 FROM public.tags WHERE account_id=v_account AND name='DESACTIVADO AMBOS');
    INSERT INTO public.contact_tags(contact_id,tag_id)
    SELECT c.contact_id,t.id FROM public.conversations c JOIN public.tags t ON t.account_id=c.account_id
    WHERE c.id=p_conversation AND t.name='DESACTIVADO AMBOS' ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM public.contact_tags ct USING public.tags t,public.conversations c
    WHERE c.id=p_conversation AND ct.contact_id=c.contact_id AND t.id=ct.tag_id
      AND t.account_id=v_account AND t.name='DESACTIVADO AMBOS';
  END IF;
  UPDATE public.conversations
  SET ai_enabled = NOT p_paused,
      automation_enabled = NOT p_paused,
      ai_autoreply_disabled = p_paused,
      ai_disabled_at = NULL,
      automation_disabled_at = NULL
  WHERE id = p_conversation AND account_id = v_account;

  IF p_paused THEN
    UPDATE public.automation_pending_executions
    SET status = 'paused'
    WHERE account_id = v_account
      AND context->>'conversation_id' = p_conversation::text
      AND status = 'pending';
  ELSE
    UPDATE public.automation_pending_executions
    SET status = 'pending'
    WHERE account_id = v_account
      AND context->>'conversation_id' = p_conversation::text
      AND status = 'paused';
  END IF;

  RETURN true;
END;
$function$;


CREATE OR REPLACE FUNCTION public.set_conversation_automatic_control(p_conversation uuid,p_control text,p_enabled boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.conversations;
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_member_permission(auth.uid(),'inbox','send')
   OR crm_private.inbox_visible_from(p_conversation) IS NULL OR p_control NOT IN ('ai','automation') THEN
   RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501';
 END IF;
 SELECT * INTO c FROM public.conversations WHERE id=p_conversation FOR UPDATE;
 IF NOT FOUND OR NOT public.is_account_member(c.account_id) THEN RETURN false; END IF;
 -- Only an explicit enable releases the canonical pause, never an incoming message.
 IF p_enabled THEN
   DELETE FROM public.contact_tags ct USING public.tags t
   WHERE ct.contact_id=c.contact_id AND ct.tag_id=t.id AND t.account_id=c.account_id AND t.name='DESACTIVADO AMBOS';
 END IF;
 UPDATE public.conversations SET
   ai_enabled=CASE WHEN p_control='ai' THEN p_enabled ELSE c.ai_enabled END,
   ai_autoreply_disabled=CASE WHEN p_control='ai' THEN NOT p_enabled ELSE c.ai_autoreply_disabled END,
   ai_disabled_at=CASE WHEN p_control='ai' THEN CASE WHEN p_enabled THEN NULL ELSE now() END ELSE c.ai_disabled_at END,
   automation_enabled=CASE WHEN p_control='automation' THEN p_enabled ELSE c.automation_enabled END,
   automation_disabled_at=CASE WHEN p_control='automation' THEN CASE WHEN p_enabled THEN NULL ELSE now() END ELSE c.automation_disabled_at END
 WHERE id=c.id;
 UPDATE public.automation_pending_executions e SET status=CASE WHEN p_enabled THEN 'pending' ELSE 'paused' END
 WHERE p_control='automation' AND e.account_id=c.account_id AND e.context->>'conversation_id'=c.id::text
   AND e.status=CASE WHEN p_enabled THEN 'paused' ELSE 'pending' END;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.set_conversation_automatic_control(uuid,text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_conversation_automatic_control(uuid,text,boolean) TO authenticated;
REVOKE ALL ON FUNCTION crm_private.guard_indefinite_automatic_pause() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION crm_private.sync_indefinite_automatic_pause_tag() FROM PUBLIC,anon,authenticated;

-- Make the control available in the existing tag picker, without changing ordinary labels.
INSERT INTO public.tags(account_id,user_id,name,color,kind,audience)
SELECT DISTINCT ON(c.account_id) c.account_id,c.user_id,'DESACTIVADO AMBOS','#64748b','process',
 '{"users":[],"areas":[],"roles":[]}'::jsonb
FROM public.conversations c
WHERE NOT EXISTS(SELECT 1 FROM public.tags t WHERE t.account_id=c.account_id AND t.name='DESACTIVADO AMBOS')
ORDER BY c.account_id,c.id;

-- Preserve the precise state written by the previous indefinite-pause RPC.
INSERT INTO public.contact_tags(contact_id,tag_id)
SELECT DISTINCT c.contact_id,t.id FROM public.conversations c JOIN public.tags t ON t.account_id=c.account_id
WHERE t.name='DESACTIVADO AMBOS' AND c.ai_enabled IS FALSE AND c.automation_enabled IS FALSE
 AND c.ai_autoreply_disabled IS TRUE AND c.ai_disabled_at IS NULL AND c.automation_disabled_at IS NULL
ON CONFLICT DO NOTHING;
