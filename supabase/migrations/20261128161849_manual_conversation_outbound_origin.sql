BEGIN;
ALTER TABLE public.whatsapp_session_outbound_jobs ADD COLUMN manual_initiated boolean NOT NULL DEFAULT false;
CREATE OR REPLACE FUNCTION public.enqueue_whatsapp_session_manual_text(p_account_id uuid,p_conversation_id uuid,p_line_key text,p_sender_id uuid,p_body text,p_dedup_key text) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE conv public.conversations;person public.contacts;line public.multichannel_whatsapp_session_lines;source public.messages;linked public.messages;job public.whatsapp_session_outbound_jobs;msg public.messages;phone text;tick timestamptz:=clock_timestamp();
BEGIN
 IF p_sender_id IS NULL OR p_body IS NULL OR length(btrim(p_body)) NOT BETWEEN 1 AND 4000 OR p_dedup_key IS NULL OR length(p_dedup_key) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Mensaje inválido' USING ERRCODE='22023';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE user_id=p_sender_id AND account_id=p_account_id AND account_role IN('owner','admin','agent')) OR NOT public.has_member_permission(p_sender_id,'inbox','send') THEN RAISE EXCEPTION 'No tienes permiso para responder' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_account_id::text||':manual-chat:'||p_line_key||':'||p_dedup_key,0));
 SELECT * INTO job FROM public.whatsapp_session_outbound_jobs WHERE account_id=p_account_id AND line_key=p_line_key AND dedup_key=p_dedup_key;
 IF FOUND THEN
  IF job.conversation_id<>p_conversation_id OR job.sender_id IS DISTINCT FROM p_sender_id OR job.body<>btrim(p_body) THEN RAISE EXCEPTION 'Identificador usado para otro mensaje' USING ERRCODE='22023';END IF;
  SELECT * INTO msg FROM public.messages WHERE id=job.message_row_id;
  RETURN jsonb_build_object('job_id',job.id,'message_id',msg.message_id,'message_row_id',msg.id,'duplicate',true);
 END IF;
 SELECT * INTO conv FROM public.conversations WHERE id=p_conversation_id AND account_id=p_account_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Chat no disponible' USING ERRCODE='42501';END IF;
 SELECT * INTO source FROM public.messages WHERE conversation_id=conv.id AND sender_type='customer' ORDER BY created_at DESC,id DESC LIMIT 1;
 SELECT * INTO linked FROM public.messages WHERE conversation_id=conv.id AND whatsapp_session_line_key IS NOT NULL ORDER BY created_at DESC,id DESC LIMIT 1;
 IF conv.whatsapp_support_line_key IS DISTINCT FROM p_line_key AND source.whatsapp_session_line_key IS DISTINCT FROM p_line_key
 AND NOT(coalesce(linked.whatsapp_session_line_key=p_line_key,false) AND (source.id IS NULL OR (linked.created_at,linked.id)>=(source.created_at,source.id))) THEN RAISE EXCEPTION 'Elige el número desde Comenzar conversación' USING ERRCODE='42501';END IF;
 SELECT l.* INTO line FROM public.multichannel_whatsapp_session_lines l JOIN public.multichannel_workers w ON w.id=l.worker_id AND w.account_id=l.account_id AND w.enabled
 WHERE l.account_id=p_account_id AND l.line_key=p_line_key AND NOT l.paused AND l.support_ready_at>tick-interval '20 seconds' FOR SHARE OF l,w;
 IF NOT FOUND THEN RAISE EXCEPTION 'Ese WhatsApp no está disponible; no se enviará por Meta' USING ERRCODE='42501';END IF;
 SELECT * INTO person FROM public.contacts WHERE id=conv.contact_id AND account_id=p_account_id AND channel='whatsapp';
 phone:=regexp_replace(coalesce(nullif(person.phone_normalized,''),person.phone,''),'[^0-9]','','g');
 IF person.id IS NULL OR phone !~ '^[1-9][0-9]{6,14}$' OR EXISTS(SELECT 1 FROM public.multichannel_whatsapp_session_lines WHERE account_id=p_account_id AND linked_phone=phone) THEN RAISE EXCEPTION 'Revisa el teléfono del destinatario' USING ERRCODE='22023';END IF;
 INSERT INTO public.messages(conversation_id,sender_type,sender_id,content_type,content_text,message_id,status,created_at,whatsapp_session_line_key)
 VALUES(conv.id,'agent',p_sender_id,'text',btrim(p_body),'waweb-pending:'||gen_random_uuid()::text,'sending',tick,p_line_key) RETURNING * INTO msg;
 INSERT INTO public.whatsapp_session_outbound_jobs(account_id,line_key,worker_id,conversation_id,message_row_id,sender_type,sender_id,inbound_provider_message_id,chat_id,body,dedup_key,manual_initiated)
 VALUES(p_account_id,p_line_key,line.worker_id,conv.id,msg.id,'agent',p_sender_id,'manual:'||msg.id::text,phone||'@c.us',btrim(p_body),p_dedup_key,true) RETURNING * INTO job;
 UPDATE public.messages SET message_id='waweb-job:'||job.id::text WHERE id=msg.id RETURNING * INTO msg;
 UPDATE public.conversations SET whatsapp_support_line_key=p_line_key,whatsapp_support_wait_until=NULL,ai_enabled=false,automation_enabled=false,automation_disabled_at=tick,last_human_message_at=tick,last_message_text=btrim(p_body),last_message_at=tick,updated_at=tick WHERE id=conv.id;
 UPDATE public.whatsapp_support_waits SET status='cancelled',result='Continuación manual',completed_at=tick WHERE account_id=p_account_id AND conversation_id=conv.id AND status='pending';
 UPDATE public.flow_runs SET status='paused_by_agent',ended_at=tick,end_reason='agent_replied' WHERE account_id=p_account_id AND contact_id=conv.contact_id AND status='active';
 RETURN jsonb_build_object('job_id',job.id,'message_id',msg.message_id,'message_row_id',msg.id,'duplicate',false);
END;$$;

CREATE OR REPLACE FUNCTION public.continue_whatsapp_conversation(p_account uuid,p_conversation uuid,p_sender uuid,p_source uuid,p_line text,p_phone text,p_body text,p_request uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE conv public.conversations;source public.messages;prior public.whatsapp_session_outbound_jobs;result jsonb;
BEGIN
 IF p_request IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE user_id=p_sender AND account_id=p_account) OR NOT public.has_member_permission(p_sender,'inbox','send') THEN RAISE EXCEPTION 'No tienes permiso para responder' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_account::text||':manual-continuation:'||p_request::text,0));
 IF NOT EXISTS(SELECT 1 FROM public.multichannel_whatsapp_session_lines WHERE account_id=p_account AND line_key=p_line AND linked_phone=p_phone) THEN RAISE EXCEPTION 'El número cambió; actualiza' USING ERRCODE='42501';END IF;
 SELECT * INTO prior FROM public.whatsapp_session_outbound_jobs WHERE account_id=p_account AND line_key=p_line AND dedup_key='manual-continuation:'||p_request::text;
 IF NOT FOUND THEN
  SELECT * INTO conv FROM public.conversations WHERE id=p_conversation AND account_id=p_account FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Chat no disponible' USING ERRCODE='42501';END IF;
  SELECT * INTO source FROM public.messages WHERE conversation_id=conv.id AND sender_type='customer' ORDER BY created_at DESC,id DESC LIMIT 1;
  IF source.id IS DISTINCT FROM p_source THEN RAISE EXCEPTION 'Llegó otro mensaje; actualiza antes de continuar' USING ERRCODE='40001';END IF;
  UPDATE public.conversations SET whatsapp_support_line_key=p_line WHERE id=conv.id;
 END IF;
 result:=public.enqueue_whatsapp_session_manual_text(p_account,p_conversation,p_line,p_sender,p_body,'manual-continuation:'||p_request::text);
 RETURN result||jsonb_build_object('line_key',p_line,'phone',p_phone);
END;$$;

ALTER FUNCTION public.whatsapp_session_outbound_step(uuid,text,text,uuid,uuid,text,text) RENAME TO whatsapp_session_outbound_step_before_manual_start;
CREATE FUNCTION public.whatsapp_session_outbound_step(p_worker_id uuid,p_line_key text,p_action text,p_job_id uuid DEFAULT NULL,p_claim_token uuid DEFAULT NULL,p_state text DEFAULT NULL,p_provider_message_id text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 result:=public.whatsapp_session_outbound_step_before_manual_start(p_worker_id,p_line_key,p_action,p_job_id,p_claim_token,p_state,p_provider_message_id);
 IF p_action='authorize' AND (result->>'allowed')::boolean AND EXISTS(SELECT 1 FROM public.whatsapp_session_outbound_jobs WHERE id=p_job_id AND worker_id=p_worker_id AND line_key=p_line_key AND sender_type='agent' AND manual_initiated) THEN
  -- Existing executor capability for explicitly authorized sends without a local inbound receipt.
  result:=result||jsonb_build_object('inbound_source','cloud_support','sender_type','agent');
 END IF;RETURN result;
END;$$;
REVOKE ALL ON FUNCTION public.enqueue_whatsapp_session_manual_text(uuid,uuid,text,uuid,text,text),public.continue_whatsapp_conversation(uuid,uuid,uuid,uuid,text,text,text,uuid),public.whatsapp_session_outbound_step(uuid,text,text,uuid,uuid,text,text),public.whatsapp_session_outbound_step_before_manual_start(uuid,text,text,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_whatsapp_session_manual_text(uuid,uuid,text,uuid,text,text),public.continue_whatsapp_conversation(uuid,uuid,uuid,uuid,text,text,text,uuid),public.whatsapp_session_outbound_step(uuid,text,text,uuid,uuid,text,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
