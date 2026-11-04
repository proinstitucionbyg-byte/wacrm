-- Reuse the text queue and original CRM reply IDs for normal WhatsApp menus.
-- Schema/code only: no activation, history replay or production send.
CREATE FUNCTION public.enqueue_whatsapp_session_text_menu(
 p_account_id uuid,p_conversation_id uuid,p_line_key text,
 p_inbound_provider_message_id text,p_body text,p_dedup_key text,p_options jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_result jsonb;v_message public.messages;v_job public.whatsapp_session_outbound_jobs;
BEGIN
 IF jsonb_typeof(p_options) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid menu' USING ERRCODE='22023';END IF;
 IF jsonb_array_length(p_options) NOT BETWEEN 1 AND 10 OR EXISTS(
  SELECT 1 FROM jsonb_array_elements(p_options) AS o(value)
  WHERE jsonb_typeof(value->'id') IS DISTINCT FROM 'string' OR length(value->>'id') NOT BETWEEN 1 AND 256
   OR jsonb_typeof(value->'title') IS DISTINCT FROM 'string' OR length(btrim(value->>'title')) NOT BETWEEN 1 AND 80
 ) OR (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(p_options) AS o(value))<>jsonb_array_length(p_options)
 THEN RAISE EXCEPTION 'Invalid menu options' USING ERRCODE='22023';END IF;
 v_result:=public.enqueue_whatsapp_session_text(p_account_id,p_conversation_id,p_line_key,p_inbound_provider_message_id,p_body,p_dedup_key);
 SELECT * INTO STRICT v_job FROM public.whatsapp_session_outbound_jobs
 WHERE id=(v_result->>'job_id')::uuid AND account_id=p_account_id AND conversation_id=p_conversation_id AND line_key=p_line_key;
 SELECT * INTO STRICT v_message FROM public.messages WHERE id=v_job.message_row_id FOR UPDATE;
 IF (v_result->>'duplicate')::boolean THEN
  IF v_message.interactive_payload->'options' IS DISTINCT FROM p_options THEN RAISE EXCEPTION 'Menu request conflict' USING ERRCODE='22023';END IF;
 ELSE
  UPDATE public.messages SET interactive_payload=jsonb_build_object('kind','session_text_menu','options',p_options,'expires_at',clock_timestamp()+interval '24 hours') WHERE id=v_message.id;
 END IF;
 RETURN v_result;
END;$$;
REVOKE ALL ON FUNCTION public.enqueue_whatsapp_session_text_menu(uuid,uuid,text,text,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_whatsapp_session_text_menu(uuid,uuid,text,text,text,text,jsonb) TO service_role;

CREATE FUNCTION public.resolve_whatsapp_session_menu_reply(
 p_worker_id uuid,p_line_key text,p_conversation_id uuid,p_inbound_row_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_inbound public.messages;v_prompt public.messages;v_choice integer;v_option jsonb;
BEGIN
 SELECT m.* INTO v_inbound FROM public.messages m
 JOIN public.whatsapp_session_inbound_receipts r ON r.message_row_id=m.id AND r.line_key=p_line_key
 JOIN public.multichannel_whatsapp_session_lines l ON l.account_id=r.account_id AND l.line_key=r.line_key AND l.worker_id=p_worker_id AND NOT l.paused
 JOIN public.multichannel_workers w ON w.id=l.worker_id AND w.account_id=l.account_id AND w.enabled
 JOIN public.conversations c ON c.id=m.conversation_id AND c.account_id=l.account_id AND c.automation_enabled
 WHERE m.id=p_inbound_row_id AND m.conversation_id=p_conversation_id AND m.sender_type='customer'
  AND m.whatsapp_session_line_key=p_line_key FOR UPDATE OF m;
 IF NOT FOUND THEN RETURN NULL;END IF;
 IF v_inbound.interactive_payload->>'kind'='session_text_menu_reply' THEN RETURN jsonb_build_object('reply_id',v_inbound.interactive_payload->>'reply_id');END IF;
 IF btrim(v_inbound.content_text) !~ '^([1-9]|10)$' THEN RETURN NULL;END IF;
 -- Serialize competing replies to the same prompt. Only one new input consumes it.
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_conversation_id::text||':session-menu:'||p_line_key,0));
 SELECT m.* INTO v_prompt FROM public.messages m
 WHERE m.conversation_id=p_conversation_id AND m.sender_type IN ('bot','agent')
  AND m.whatsapp_session_line_key=p_line_key AND m.created_at<=v_inbound.created_at
 ORDER BY m.created_at DESC,m.id DESC LIMIT 1 FOR UPDATE;
 IF NOT FOUND OR v_prompt.interactive_payload->>'kind' IS DISTINCT FROM 'session_text_menu'
  OR v_prompt.interactive_payload ? 'consumed_by'
  OR (v_prompt.interactive_payload->>'expires_at')::timestamptz<=clock_timestamp()
  OR NOT EXISTS(SELECT 1 FROM public.whatsapp_session_outbound_jobs j WHERE j.message_row_id=v_prompt.id
    AND j.worker_id=p_worker_id AND j.line_key=p_line_key AND j.status IN ('accepted','delivered','read')
    AND j.provider_message_id IS NOT NULL AND j.started_at<=v_inbound.created_at)
 THEN RETURN NULL;END IF;
 v_choice:=btrim(v_inbound.content_text)::integer;
 v_option:=v_prompt.interactive_payload->'options'->(v_choice-1);
 IF v_option IS NULL THEN RETURN NULL;END IF;
 UPDATE public.messages SET interactive_payload=interactive_payload||jsonb_build_object('consumed_by',v_inbound.id) WHERE id=v_prompt.id;
 UPDATE public.messages SET interactive_payload=jsonb_build_object('kind','session_text_menu_reply','reply_id',v_option->>'id','prompt_row_id',v_prompt.id) WHERE id=v_inbound.id;
 RETURN jsonb_build_object('reply_id',v_option->>'id');
END;$$;
REVOKE ALL ON FUNCTION public.resolve_whatsapp_session_menu_reply(uuid,text,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_whatsapp_session_menu_reply(uuid,text,uuid,uuid) TO service_role;
