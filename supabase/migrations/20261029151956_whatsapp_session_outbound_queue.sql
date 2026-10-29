-- Outbound text queue for the existing owner-bound WhatsApp Web session.
-- This migration creates schema only; the send feature remains opt-in.
CREATE TABLE public.whatsapp_session_outbound_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  line_key text NOT NULL,
  worker_id uuid NOT NULL,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  message_row_id uuid NOT NULL UNIQUE REFERENCES public.messages(id) ON DELETE CASCADE,
  sender_type text NOT NULL DEFAULT 'bot' CHECK (sender_type IN ('bot','agent')),
  sender_id uuid,
  inbound_provider_message_id text NOT NULL CHECK (length(inbound_provider_message_id) BETWEEN 1 AND 1024),
  chat_id text NOT NULL CHECK (chat_id ~ '^[0-9]{7,15}@c\.us$'),
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 4000),
  dedup_key text NOT NULL CHECK (length(dedup_key) BETWEEN 1 AND 200),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN
    ('queued','claimed','dispatching','accepted','delivered','read','failed','needs_review','cancelled')),
  claim_token uuid,
  lease_until timestamptz,
  provider_message_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  UNIQUE (account_id, line_key, dedup_key),
  FOREIGN KEY (account_id, line_key)
    REFERENCES public.multichannel_whatsapp_session_lines(account_id, line_key) ON DELETE CASCADE,
  FOREIGN KEY (account_id, worker_id)
    REFERENCES public.multichannel_workers(account_id, id) ON DELETE CASCADE,
  CHECK ((sender_type='bot' AND sender_id IS NULL) OR (sender_type='agent' AND sender_id IS NOT NULL)),
  CHECK ((status IN ('claimed','dispatching')) = (claim_token IS NOT NULL AND lease_until IS NOT NULL))
);

CREATE INDEX whatsapp_session_outbound_due
  ON public.whatsapp_session_outbound_jobs(account_id,line_key,created_at,id)
  WHERE status='queued';
CREATE UNIQUE INDEX whatsapp_session_outbound_line_busy
  ON public.whatsapp_session_outbound_jobs(account_id,line_key)
  WHERE status IN ('claimed','dispatching');
CREATE UNIQUE INDEX whatsapp_session_outbound_worker_busy
  ON public.whatsapp_session_outbound_jobs(worker_id)
  WHERE status IN ('claimed','dispatching');

ALTER TABLE public.whatsapp_session_outbound_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_session_outbound_jobs FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.whatsapp_session_outbound_jobs TO service_role;

CREATE FUNCTION public.enqueue_whatsapp_session_text(
  p_account_id uuid,
  p_conversation_id uuid,
  p_line_key text,
  p_inbound_provider_message_id text,
  p_body text,
  p_dedup_key text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_line public.multichannel_whatsapp_session_lines;
  v_conversation public.conversations;
  v_contact public.contacts;
  v_message public.messages;
  v_job public.whatsapp_session_outbound_jobs;
  v_chat_id text;
  v_message_id text;
  v_tick timestamptz := clock_timestamp();
BEGIN
  IF p_body IS NULL OR length(btrim(p_body)) NOT BETWEEN 1 AND 4000
     OR p_dedup_key IS NULL OR length(p_dedup_key) NOT BETWEEN 1 AND 200
     OR p_inbound_provider_message_id IS NULL
     OR length(p_inbound_provider_message_id) NOT BETWEEN 1 AND 1024 THEN
    RAISE EXCEPTION 'Invalid outbound WhatsApp session request' USING ERRCODE='22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_account_id::text || ':wa-session-out:' || p_line_key || ':' || p_dedup_key, 0));
  SELECT * INTO v_job FROM public.whatsapp_session_outbound_jobs j
    WHERE j.account_id=p_account_id AND j.line_key=p_line_key AND j.dedup_key=p_dedup_key;
  IF FOUND THEN
    SELECT m.message_id INTO v_message_id FROM public.messages m WHERE m.id=v_job.message_row_id;
    RETURN jsonb_build_object('job_id',v_job.id,'message_id',v_message_id,'duplicate',true);
  END IF;

  SELECT l.* INTO v_line FROM public.multichannel_whatsapp_session_lines l
    JOIN public.multichannel_workers w ON w.id=l.worker_id AND w.account_id=l.account_id
    WHERE l.account_id=p_account_id AND l.line_key=p_line_key AND NOT l.paused AND w.enabled
    FOR SHARE OF l,w;
  IF NOT FOUND THEN RAISE EXCEPTION 'WhatsApp session line is unavailable' USING ERRCODE='42501'; END IF;

  SELECT * INTO v_conversation FROM public.conversations c
    WHERE c.id=p_conversation_id AND c.account_id=p_account_id FOR UPDATE;
  IF NOT FOUND OR v_conversation.automation_enabled IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Conversation automation is paused' USING ERRCODE='42501';
  END IF;
  IF v_conversation.last_human_message_at IS NOT NULL
     AND v_conversation.last_human_message_at > v_tick - interval '5 minutes' THEN
    RAISE EXCEPTION 'A human is attending this conversation' USING ERRCODE='42501';
  END IF;

  SELECT * INTO v_message FROM public.messages m
    JOIN public.whatsapp_session_inbound_receipts r
      ON r.message_row_id=m.id AND r.account_id=p_account_id AND r.line_key=p_line_key
      AND r.provider_message_id=p_inbound_provider_message_id
    WHERE m.conversation_id=p_conversation_id AND m.sender_type='customer'
      AND m.whatsapp_session_line_key=p_line_key;
  IF NOT FOUND OR EXISTS (
    SELECT 1 FROM public.messages newer
    WHERE newer.conversation_id=p_conversation_id AND newer.sender_type='customer'
      AND newer.created_at > v_message.created_at
  ) THEN
    RAISE EXCEPTION 'Inbound message is no longer the latest customer message' USING ERRCODE='42501';
  END IF;

  SELECT * INTO v_contact FROM public.contacts c
    WHERE c.id=v_conversation.contact_id AND c.account_id=p_account_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Contact is unavailable' USING ERRCODE='42501'; END IF;
  v_chat_id := regexp_replace(coalesce(nullif(v_contact.phone_normalized,''),v_contact.phone,''),'[^0-9]','','g') || '@c.us';
  IF v_chat_id !~ '^[0-9]{7,15}@c\.us$' THEN
    RAISE EXCEPTION 'Contact needs phone review before WhatsApp session send' USING ERRCODE='22023';
  END IF;

  INSERT INTO public.messages(conversation_id,sender_type,content_type,content_text,message_id,status,created_at,whatsapp_session_line_key)
    VALUES(p_conversation_id,'bot','text',btrim(p_body),'waweb-pending:'||gen_random_uuid()::text,'sending',v_tick,p_line_key)
    RETURNING * INTO v_message;
  v_message_id := v_message.message_id;
  INSERT INTO public.whatsapp_session_outbound_jobs(
    account_id,line_key,worker_id,conversation_id,message_row_id,inbound_provider_message_id,chat_id,body,dedup_key
  ) VALUES (
    p_account_id,p_line_key,v_line.worker_id,p_conversation_id,v_message.id,
    p_inbound_provider_message_id,v_chat_id,btrim(p_body),p_dedup_key
  ) RETURNING * INTO v_job;
  UPDATE public.messages SET message_id='waweb-job:'||v_job.id::text WHERE id=v_message.id RETURNING message_id INTO v_message_id;
  UPDATE public.conversations SET last_message_text=btrim(p_body),last_message_at=v_tick,updated_at=v_tick
    WHERE id=p_conversation_id AND account_id=p_account_id;
  RETURN jsonb_build_object('job_id',v_job.id,'message_id',v_message_id,'duplicate',false);
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_whatsapp_session_text(uuid,uuid,text,text,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_whatsapp_session_text(uuid,uuid,text,text,text,text) TO service_role;

-- Human replies from the CRM use the same line-bound queue, but are explicitly
-- attributed to an authenticated team member and pause automated follow-up.
CREATE FUNCTION public.enqueue_whatsapp_session_manual_text(
  p_account_id uuid,
  p_conversation_id uuid,
  p_line_key text,
  p_sender_id uuid,
  p_body text,
  p_dedup_key text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_line public.multichannel_whatsapp_session_lines;
  v_conversation public.conversations;
  v_contact public.contacts;
  v_message public.messages;
  v_job public.whatsapp_session_outbound_jobs;
  v_source public.messages;
  v_receipt_id text;
  v_chat_id text;
  v_tick timestamptz := clock_timestamp();
BEGIN
  IF p_body IS NULL OR length(btrim(p_body)) NOT BETWEEN 1 AND 4000
     OR p_dedup_key IS NULL OR length(p_dedup_key) NOT BETWEEN 1 AND 200
     OR p_sender_id IS NULL THEN
    RAISE EXCEPTION 'Invalid manual WhatsApp session request' USING ERRCODE='22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_account_id::text || ':wa-session-manual:' || p_line_key || ':' || p_dedup_key, 0));
  SELECT * INTO v_job FROM public.whatsapp_session_outbound_jobs j
    WHERE j.account_id=p_account_id AND j.line_key=p_line_key AND j.dedup_key=p_dedup_key;
  IF FOUND THEN
    SELECT m.* INTO v_message FROM public.messages m WHERE m.id=v_job.message_row_id;
    RETURN jsonb_build_object('job_id',v_job.id,'message_id',v_message.message_id,
      'message_row_id',v_message.id,'duplicate',true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id=p_sender_id
    AND p.account_id=p_account_id AND p.account_role IN ('owner','admin','agent')) THEN
    RAISE EXCEPTION 'Sender is not an authorized account member' USING ERRCODE='42501';
  END IF;

  SELECT l.* INTO v_line FROM public.multichannel_whatsapp_session_lines l
    JOIN public.multichannel_workers w ON w.id=l.worker_id AND w.account_id=l.account_id
    WHERE l.account_id=p_account_id AND l.line_key=p_line_key AND NOT l.paused AND w.enabled
    FOR SHARE OF l,w;
  IF NOT FOUND THEN RAISE EXCEPTION 'WhatsApp session line is unavailable' USING ERRCODE='42501'; END IF;

  SELECT * INTO v_conversation FROM public.conversations c
    WHERE c.id=p_conversation_id AND c.account_id=p_account_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conversation is unavailable' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_source FROM public.messages m
    WHERE m.conversation_id=p_conversation_id AND m.sender_type='customer'
      AND m.whatsapp_session_line_key=p_line_key
    ORDER BY m.created_at DESC,m.id DESC LIMIT 1;
  IF NOT FOUND OR EXISTS (SELECT 1 FROM public.messages newer
    WHERE newer.conversation_id=p_conversation_id AND newer.sender_type='customer'
      AND (newer.created_at,newer.id)>(v_source.created_at,v_source.id)) THEN
    RAISE EXCEPTION 'Latest customer message is not from this WhatsApp line' USING ERRCODE='42501';
  END IF;
  SELECT r.provider_message_id INTO v_receipt_id FROM public.whatsapp_session_inbound_receipts r
    WHERE r.account_id=p_account_id AND r.line_key=p_line_key AND r.message_row_id=v_source.id;
  IF v_receipt_id IS NULL THEN RAISE EXCEPTION 'Inbound WhatsApp receipt is unavailable' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_contact FROM public.contacts c
    WHERE c.id=v_conversation.contact_id AND c.account_id=p_account_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Contact is unavailable' USING ERRCODE='42501'; END IF;
  v_chat_id := regexp_replace(coalesce(nullif(v_contact.phone_normalized,''),v_contact.phone,''),'[^0-9]','','g') || '@c.us';
  IF v_chat_id !~ '^[0-9]{7,15}@c\.us$' THEN
    RAISE EXCEPTION 'Contact needs phone review before WhatsApp session send' USING ERRCODE='22023';
  END IF;

  INSERT INTO public.messages(conversation_id,sender_type,sender_id,content_type,content_text,message_id,status,created_at,whatsapp_session_line_key)
    VALUES(p_conversation_id,'agent',p_sender_id,'text',btrim(p_body),'waweb-pending:'||gen_random_uuid()::text,'sending',v_tick,p_line_key)
    RETURNING * INTO v_message;
  INSERT INTO public.whatsapp_session_outbound_jobs(
    account_id,line_key,worker_id,conversation_id,message_row_id,sender_type,sender_id,
    inbound_provider_message_id,chat_id,body,dedup_key
  ) VALUES (
    p_account_id,p_line_key,v_line.worker_id,p_conversation_id,v_message.id,'agent',p_sender_id,
    v_receipt_id,v_chat_id,btrim(p_body),p_dedup_key
  ) RETURNING * INTO v_job;
  UPDATE public.messages SET message_id='waweb-job:'||v_job.id::text WHERE id=v_message.id RETURNING * INTO v_message;
  UPDATE public.conversations SET ai_enabled=false,automation_enabled=false,
    automation_disabled_at=v_tick,last_human_message_at=v_tick,last_message_text=btrim(p_body),
    last_message_at=v_tick,updated_at=v_tick
    WHERE id=p_conversation_id AND account_id=p_account_id;
  UPDATE public.flow_runs SET status='paused_by_agent',ended_at=v_tick,end_reason='agent_replied'
    WHERE account_id=p_account_id AND contact_id=v_conversation.contact_id AND status='active';
  RETURN jsonb_build_object('job_id',v_job.id,'message_id',v_message.message_id,
    'message_row_id',v_message.id,'duplicate',false);
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_whatsapp_session_manual_text(uuid,uuid,text,uuid,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_whatsapp_session_manual_text(uuid,uuid,text,uuid,text,text) TO service_role;

CREATE FUNCTION public.whatsapp_session_outbound_step(
  p_worker_id uuid,
  p_line_key text,
  p_action text,
  p_job_id uuid DEFAULT NULL,
  p_claim_token uuid DEFAULT NULL,
  p_state text DEFAULT NULL,
  p_provider_message_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_worker public.multichannel_workers;
  v_line public.multichannel_whatsapp_session_lines;
  v_job public.whatsapp_session_outbound_jobs;
  v_conversation public.conversations;
  v_tick timestamptz := clock_timestamp();
  v_permitted boolean := false;
BEGIN
  SELECT * INTO v_worker FROM public.multichannel_workers w WHERE w.id=p_worker_id AND w.enabled;
  IF NOT FOUND THEN RAISE EXCEPTION 'Worker unavailable' USING ERRCODE='42501'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_worker.account_id::text,0));
  SELECT * INTO v_worker FROM public.multichannel_workers w WHERE w.id=p_worker_id AND w.enabled FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Worker unavailable' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_line FROM public.multichannel_whatsapp_session_lines l
    WHERE l.account_id=v_worker.account_id AND l.line_key=p_line_key AND l.worker_id=v_worker.id AND NOT l.paused FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Line unavailable or paused' USING ERRCODE='42501'; END IF;

  IF p_action='claim' THEN
    UPDATE public.whatsapp_session_outbound_jobs SET
      status=CASE WHEN status='dispatching' THEN 'needs_review' ELSE 'queued' END,
      finished_at=CASE WHEN status='dispatching' THEN v_tick ELSE NULL END,
      claim_token=NULL,lease_until=NULL
    WHERE account_id=v_worker.account_id AND line_key=p_line_key
      AND status IN ('claimed','dispatching') AND lease_until<=v_tick;
    -- An unexpired claim/dispatch belongs to its current owner. Returning it
    -- to another poller would allow the same WhatsApp message to be sent twice.
    IF EXISTS (SELECT 1 FROM public.whatsapp_session_outbound_jobs j
      WHERE j.account_id=v_worker.account_id AND j.line_key=p_line_key
        AND j.status IN ('claimed','dispatching')) THEN RETURN NULL; END IF;
    SELECT * INTO v_job FROM public.whatsapp_session_outbound_jobs j
      WHERE j.account_id=v_worker.account_id AND j.line_key=p_line_key AND j.worker_id=v_worker.id AND j.status='queued'
      ORDER BY j.created_at,j.id LIMIT 1 FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN RETURN NULL; END IF;
    UPDATE public.whatsapp_session_outbound_jobs SET status='claimed',claim_token=gen_random_uuid(),
      lease_until=v_tick+interval '2 minutes'
      WHERE id=v_job.id RETURNING * INTO v_job;
    UPDATE public.multichannel_workers SET last_seen_at=v_tick WHERE id=v_worker.id;
    RETURN to_jsonb(v_job);
  END IF;

  SELECT * INTO v_job FROM public.whatsapp_session_outbound_jobs j
    WHERE j.id=p_job_id AND j.account_id=v_worker.account_id AND j.line_key=p_line_key FOR UPDATE;
  IF NOT FOUND OR v_job.worker_id IS DISTINCT FROM v_worker.id
     OR v_job.claim_token IS DISTINCT FROM p_claim_token OR v_job.lease_until<=v_tick THEN RETURN NULL; END IF;

  IF p_action='authorize' AND v_job.status IN ('claimed','dispatching') THEN
    SELECT * INTO v_conversation FROM public.conversations c
      WHERE c.id=v_job.conversation_id AND c.account_id=v_job.account_id;
    v_permitted := FOUND AND (
      (v_job.sender_type='agent' AND v_job.sender_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.profiles p WHERE p.user_id=v_job.sender_id
          AND p.account_id=v_job.account_id AND p.account_role IN ('owner','admin','agent')
      ))
      OR (v_job.sender_type='bot' AND v_conversation.automation_enabled IS TRUE
      AND (v_conversation.last_human_message_at IS NULL OR v_conversation.last_human_message_at<=v_tick-interval '5 minutes')
      AND EXISTS (
        SELECT 1 FROM public.messages source
        JOIN public.whatsapp_session_inbound_receipts r ON r.message_row_id=source.id
          AND r.account_id=v_job.account_id AND r.line_key=v_job.line_key
          AND r.provider_message_id=v_job.inbound_provider_message_id
        WHERE source.conversation_id=v_job.conversation_id AND source.sender_type='customer'
          AND source.whatsapp_session_line_key=v_job.line_key
          AND NOT EXISTS (SELECT 1 FROM public.messages newer WHERE newer.conversation_id=v_job.conversation_id
            AND newer.sender_type='customer' AND newer.created_at>source.created_at)
      ))
    );
    IF NOT v_permitted OR v_line.paused OR NOT v_worker.enabled THEN
      UPDATE public.whatsapp_session_outbound_jobs SET status='cancelled',finished_at=v_tick,
        claim_token=NULL,lease_until=NULL WHERE id=v_job.id;
      UPDATE public.messages SET status='failed' WHERE id=v_job.message_row_id;
      RETURN jsonb_build_object('allowed',false);
    END IF;
    IF v_job.status='claimed' THEN
      UPDATE public.whatsapp_session_outbound_jobs SET status='dispatching',started_at=v_tick,lease_until=v_tick+interval '2 minutes'
        WHERE id=v_job.id RETURNING * INTO v_job;
    END IF;
    RETURN jsonb_build_object('allowed',true,'job_id',v_job.id,'account_id',v_job.account_id,
      'line_key',v_job.line_key,'session_phone',v_line.linked_phone,'chat_id',v_job.chat_id,
      'inbound_provider_message_id',v_job.inbound_provider_message_id,'body',v_job.body,
      'claim_token',v_job.claim_token,'message_id',
      (SELECT m.message_id FROM public.messages m WHERE m.id=v_job.message_row_id),
      'expires_at',v_tick+interval '20 seconds');
  ELSIF p_action='record' AND v_job.status='dispatching' THEN
    IF p_state NOT IN ('accepted','delivered','read','failed','needs_review','cancelled') THEN
      RAISE EXCEPTION 'Invalid WhatsApp session result' USING ERRCODE='22023';
    END IF;
    IF p_state IN ('accepted','delivered','read') AND (p_provider_message_id IS NULL OR length(p_provider_message_id) NOT BETWEEN 1 AND 1024) THEN
      RAISE EXCEPTION 'Provider message id required' USING ERRCODE='22023';
    END IF;
    UPDATE public.whatsapp_session_outbound_jobs SET status=p_state,provider_message_id=p_provider_message_id,
      finished_at=CASE WHEN p_state IN ('delivered','read','failed','needs_review','cancelled') THEN v_tick ELSE NULL END,
      claim_token=NULL,lease_until=NULL WHERE id=v_job.id RETURNING * INTO v_job;
    UPDATE public.messages SET
      message_id=CASE WHEN p_state IN ('accepted','delivered','read') THEN p_provider_message_id ELSE message_id END,
      status=CASE p_state WHEN 'accepted' THEN 'sent' WHEN 'delivered' THEN 'delivered'
      WHEN 'read' THEN 'read' WHEN 'failed' THEN 'failed' WHEN 'needs_review' THEN 'sending'
      WHEN 'cancelled' THEN 'failed' END
      WHERE id=v_job.message_row_id;
    RETURN jsonb_build_object('recorded',true,'status',v_job.status,'message_id',
      (SELECT m.message_id FROM public.messages m WHERE m.id=v_job.message_row_id));
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.whatsapp_session_outbound_step(uuid,text,text,uuid,uuid,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_session_outbound_step(uuid,text,text,uuid,uuid,text,text) TO service_role;
