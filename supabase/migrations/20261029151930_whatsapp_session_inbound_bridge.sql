-- Receive only from owner-bound WhatsApp Web sessions. This migration does
-- not enable sending or connect these sessions to the Cloud API.
CREATE TABLE public.multichannel_whatsapp_session_lines (
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  line_key text NOT NULL CHECK (line_key ~ '^WA-[A-Za-z0-9_-]{1,60}$'),
  worker_id uuid NOT NULL,
  linked_phone text NOT NULL CHECK (linked_phone ~ '^[0-9]{7,15}$'),
  paused boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, line_key),
  FOREIGN KEY (account_id, worker_id)
    REFERENCES public.multichannel_workers(account_id, id) ON DELETE CASCADE
);

ALTER TABLE public.multichannel_whatsapp_session_lines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.multichannel_whatsapp_session_lines FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.multichannel_whatsapp_session_lines TO service_role;

CREATE TABLE public.whatsapp_session_inbound_receipts (
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  line_key text NOT NULL,
  provider_message_id text NOT NULL CHECK (length(provider_message_id) BETWEEN 1 AND 1024),
  message_row_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  contact_created boolean NOT NULL DEFAULT false,
  is_first_inbound boolean NOT NULL DEFAULT false,
  previous_inbound_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, line_key, provider_message_id),
  FOREIGN KEY (account_id, line_key)
    REFERENCES public.multichannel_whatsapp_session_lines(account_id, line_key) ON DELETE CASCADE
);

ALTER TABLE public.whatsapp_session_inbound_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_session_inbound_receipts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.whatsapp_session_inbound_receipts TO service_role;

ALTER TABLE public.messages
  ADD COLUMN whatsapp_session_line_key text
  CHECK (whatsapp_session_line_key IS NULL OR whatsapp_session_line_key ~ '^WA-[A-Za-z0-9_-]{1,60}$');

CREATE FUNCTION public.protect_whatsapp_session_line_key()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF current_user NOT IN ('postgres', 'service_role') AND (
    (TG_OP = 'INSERT' AND NEW.whatsapp_session_line_key IS NOT NULL) OR
    (TG_OP = 'UPDATE' AND NEW.whatsapp_session_line_key IS DISTINCT FROM OLD.whatsapp_session_line_key)
  ) THEN
    RAISE EXCEPTION 'La línea de sesión WhatsApp se fija en servidor' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER protect_whatsapp_session_line_key BEFORE INSERT OR UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.protect_whatsapp_session_line_key();

CREATE FUNCTION public.record_whatsapp_session_inbound(
  p_worker_id uuid,
  p_line_key text,
  p_linked_phone text,
  p_provider_message_id text,
  p_sender_phone text,
  p_occurred_at timestamptz,
  p_content_type text,
  p_content_text text
) RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_account_id uuid;
  v_owner_id uuid;
  v_contact_id uuid;
  v_conversation_id uuid;
  v_message_id uuid;
  v_content_text text;
  v_contact_created boolean := false;
  v_previous_inbound_at timestamptz;
  v_is_first_inbound boolean := true;
BEGIN
  IF p_line_key IS NULL OR p_line_key !~ '^WA-[A-Za-z0-9_-]{1,60}$'
     OR p_linked_phone IS NULL OR p_linked_phone !~ '^[0-9]{7,15}$'
     OR p_provider_message_id IS NULL OR length(p_provider_message_id) NOT BETWEEN 1 AND 1024
     OR p_sender_phone IS NULL OR p_sender_phone !~ '^[0-9]{7,15}$'
     OR p_occurred_at IS NULL OR p_occurred_at < '2009-01-01'::timestamptz
     OR p_occurred_at > now() + interval '5 minutes'
     OR p_content_type IS NULL OR p_content_type NOT IN ('text','image','video','document','audio','location','interactive')
     OR length(coalesce(p_content_text,'')) > 65536 THEN
    RAISE EXCEPTION 'Evento entrante inválido' USING ERRCODE = '22023';
  END IF;

  SELECT w.account_id INTO v_account_id FROM public.multichannel_workers w
    WHERE w.id = p_worker_id AND w.enabled FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ejecutor no autorizado' USING ERRCODE = '42501'; END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_account_id::text || ':wa-session:' || p_line_key || ':' || p_provider_message_id, 0));
  IF EXISTS (SELECT 1 FROM public.whatsapp_session_inbound_receipts r
      WHERE r.account_id = v_account_id AND r.line_key = p_line_key
        AND r.provider_message_id = p_provider_message_id) THEN
    RETURN 'duplicate';
  END IF;

  PERFORM 1 FROM public.multichannel_whatsapp_session_lines l
    WHERE l.account_id = v_account_id AND l.line_key = p_line_key
      AND l.worker_id = p_worker_id AND l.linked_phone = p_linked_phone AND NOT l.paused FOR SHARE;
  IF NOT FOUND THEN RETURN 'paused_or_unbound'; END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_account_id::text || ':contact:' || p_sender_phone, 0));
  SELECT a.owner_user_id INTO STRICT v_owner_id FROM public.accounts a WHERE a.id = v_account_id;
  SELECT c.id INTO v_contact_id FROM public.contacts c
    WHERE c.account_id = v_account_id AND c.phone_normalized = p_sender_phone;
  IF v_contact_id IS NULL THEN
    INSERT INTO public.contacts(account_id,user_id,phone,name,channel)
      VALUES(v_account_id,v_owner_id,p_sender_phone,p_sender_phone,'whatsapp')
      RETURNING id INTO v_contact_id;
    v_contact_created := true;
  ELSE
    UPDATE public.contacts SET channel = 'whatsapp'
      WHERE id = v_contact_id AND account_id = v_account_id;
  END IF;

  SELECT c.id, c.last_customer_message_at INTO v_conversation_id, v_previous_inbound_at FROM public.conversations c
    WHERE c.account_id = v_account_id AND c.contact_id = v_contact_id FOR UPDATE;
  IF v_conversation_id IS NULL THEN
    INSERT INTO public.conversations(account_id,user_id,contact_id,automation_enabled,ai_enabled,ai_autoreply_disabled)
      VALUES(v_account_id,v_owner_id,v_contact_id,true,true,false)
      RETURNING id INTO v_conversation_id;
  ELSE
    v_is_first_inbound := v_previous_inbound_at IS NULL;
    -- P061 routes supported text through this conversation's source line and
    -- blocks unsupported sends instead of falling back to Meta Cloud. Preserve
    -- the owner's existing automation/AI choices on every inbound event.
    UPDATE public.conversations SET updated_at = now()
      WHERE id = v_conversation_id AND account_id = v_account_id;
  END IF;

  v_content_text := nullif(btrim(coalesce(p_content_text,'')), '');
  IF v_content_text IS NULL THEN
    v_content_text := CASE p_content_type
      WHEN 'image' THEN '[Imagen recibida; el archivo aún no está sincronizado]'
      WHEN 'video' THEN '[Video recibido; el archivo aún no está sincronizado]'
      WHEN 'audio' THEN '[Audio recibido; el archivo aún no está sincronizado]'
      WHEN 'document' THEN '[Documento recibido; el archivo aún no está sincronizado]'
      ELSE '[Mensaje recibido desde sesión WhatsApp]'
    END;
  END IF;

  INSERT INTO public.messages(conversation_id,sender_type,content_type,content_text,
      message_id,status,created_at,whatsapp_session_line_key)
    VALUES(v_conversation_id,'customer',p_content_type,v_content_text,
      'waweb:' || p_line_key || ':' || p_provider_message_id,
      'delivered',p_occurred_at,p_line_key)
    RETURNING id INTO v_message_id;

  INSERT INTO public.whatsapp_session_inbound_receipts(
    account_id,line_key,provider_message_id,message_row_id,contact_created,is_first_inbound,previous_inbound_at,created_at)
    VALUES(v_account_id,p_line_key,p_provider_message_id,v_message_id,v_contact_created,v_is_first_inbound,v_previous_inbound_at,p_occurred_at);

  UPDATE public.conversations SET
    last_message_text = v_content_text,
    last_message_at = greatest(coalesce(last_message_at,p_occurred_at),p_occurred_at),
    last_customer_message_at = greatest(coalesce(last_customer_message_at,p_occurred_at),p_occurred_at),
    unread_count = coalesce(unread_count,0) + 1,
    updated_at = now()
    WHERE id = v_conversation_id AND account_id = v_account_id;

  RETURN 'recorded';
END;
$$;

REVOKE ALL ON FUNCTION public.record_whatsapp_session_inbound(uuid,text,text,text,text,timestamptz,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_whatsapp_session_inbound(uuid,text,text,text,text,timestamptz,text,text)
  TO service_role;

COMMENT ON COLUMN public.messages.whatsapp_session_line_key IS
  'Owner-bound WhatsApp Web source line for an inbound message; does not represent Meta Cloud API billing.';
