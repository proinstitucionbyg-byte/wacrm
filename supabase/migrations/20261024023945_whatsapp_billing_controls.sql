-- Preserve the first confirmed click-to-WhatsApp referral and both window clocks.
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS last_customer_message_at timestamptz,
  ADD COLUMN IF NOT EXISTS first_ad_referral jsonb,
  ADD COLUMN IF NOT EXISTS first_ad_referral_at timestamptz;

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS billing_status text CHECK (billing_status IS NULL OR billing_status IN ('free','paid','unknown')),
  ADD COLUMN IF NOT EXISTS billing_billable boolean,
  ADD COLUMN IF NOT EXISTS billing_type text,
  ADD COLUMN IF NOT EXISTS billing_category text,
  ADD COLUMN IF NOT EXISTS billing_model text,
  ADD COLUMN IF NOT EXISTS billing_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS billing_delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS billing_estimated_cost numeric(14,6) CHECK (billing_estimated_cost IS NULL OR billing_estimated_cost >= 0),
  ADD COLUMN IF NOT EXISTS billing_currency text,
  ADD COLUMN IF NOT EXISTS billing_phone_number_id text,
  ADD COLUMN IF NOT EXISTS billing_recipient_id text,
  ADD COLUMN IF NOT EXISTS billing_sender text CHECK (billing_sender IS NULL OR billing_sender IN ('adviser','ai','automation','flow','broadcast','system'));

-- Older dashboard and API broadcast routes store delivery attempts in
-- broadcast_recipients instead of messages. Keep those sends in the same
-- billing ledger and let the signed Meta status webhook classify them.
ALTER TABLE public.broadcast_recipients
  ADD COLUMN IF NOT EXISTS billing_status text NOT NULL DEFAULT 'unknown' CHECK (billing_status IN ('free','paid','unknown')),
  ADD COLUMN IF NOT EXISTS billing_billable boolean,
  ADD COLUMN IF NOT EXISTS billing_type text,
  ADD COLUMN IF NOT EXISTS billing_category text,
  ADD COLUMN IF NOT EXISTS billing_model text,
  ADD COLUMN IF NOT EXISTS billing_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS billing_phone_number_id text,
  ADD COLUMN IF NOT EXISTS billing_recipient_id text,
  ADD COLUMN IF NOT EXISTS billing_estimated_cost numeric(14,6) CHECK (billing_estimated_cost IS NULL OR billing_estimated_cost >= 0),
  ADD COLUMN IF NOT EXISTS billing_currency text;

CREATE INDEX IF NOT EXISTS broadcast_recipients_billing_status_created
  ON public.broadcast_recipients(billing_status, created_at DESC);

CREATE INDEX IF NOT EXISTS messages_billing_status_created ON public.messages(billing_status,created_at DESC) WHERE sender_type <> 'customer';
CREATE INDEX IF NOT EXISTS conversations_first_ad_window ON public.conversations(account_id,first_ad_referral_at) WHERE first_ad_referral_at IS NOT NULL;

-- Keep the user's explicit one-minute, keyword-only fallback on a flow run
-- itself so later wait steps retain the "por confirmar" billing status.
ALTER TABLE public.flow_runs
  ADD COLUMN IF NOT EXISTS billing_keyword_fallback boolean NOT NULL DEFAULT false;

-- Reserve the first 1,000 monthly service messages per business phone
-- number atomically. Sent/uncertain reservations count until Meta reports
-- a failure; a failed send releases the slot.
CREATE TABLE IF NOT EXISTS public.whatsapp_service_message_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  phone_number_id text NOT NULL,
  month_start date NOT NULL,
  message_id text,
  source_message_row_id uuid REFERENCES public.messages(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','sent','delivered','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.whatsapp_service_message_reservations ENABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_service_reservations_message
  ON public.whatsapp_service_message_reservations(phone_number_id,message_id) WHERE message_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_service_reservations_source_row
  ON public.whatsapp_service_message_reservations(source_message_row_id) WHERE source_message_row_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS whatsapp_service_reservations_month_count
  ON public.whatsapp_service_message_reservations(phone_number_id,month_start,status);

CREATE OR REPLACE FUNCTION public.reserve_whatsapp_service_message(
  p_account_id uuid,
  p_phone_number_id text,
  p_allow_over_quota boolean DEFAULT false
) RETURNS TABLE(reservation_id uuid, free_tier_available boolean, used integer, remaining integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_month_start date := date_trunc('month', timezone('utc',now()))::date;
  v_used integer;
  v_reservation_id uuid;
BEGIN
  IF p_account_id IS NULL OR nullif(btrim(p_phone_number_id),'') IS NULL THEN
    RAISE EXCEPTION 'account and WhatsApp phone number are required';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_phone_number_id || ':' || v_month_start::text,0));
  SELECT count(*)::integer INTO v_used
  FROM public.whatsapp_service_message_reservations r
  WHERE r.phone_number_id=p_phone_number_id AND r.month_start=v_month_start
    AND r.status IN ('reserved','sent','delivered');
  IF v_used >= 1000 AND NOT p_allow_over_quota THEN
    RETURN QUERY SELECT NULL::uuid,false,v_used,0;
    RETURN;
  END IF;
  INSERT INTO public.whatsapp_service_message_reservations(account_id,phone_number_id,month_start,status)
  VALUES (p_account_id,p_phone_number_id,v_month_start,'reserved')
  RETURNING id INTO v_reservation_id;
  RETURN QUERY SELECT v_reservation_id,v_used < 1000,v_used+1,greatest(0,999-v_used);
END $$;
REVOKE ALL ON FUNCTION public.reserve_whatsapp_service_message(uuid,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_whatsapp_service_message(uuid,text,boolean) TO service_role;

-- The new monthly allowance started on Oct 1. Count this month's older
-- outbound WhatsApp free-form sends conservatively because their old rows
-- have no Meta pricing classification. This avoids treating the first 1,000
-- sends after deployment as a fresh free allowance.
INSERT INTO public.whatsapp_service_message_reservations(
  account_id,phone_number_id,month_start,message_id,source_message_row_id,status,created_at,updated_at
)
SELECT c.account_id,w.phone_number_id,
       date_trunc('month',m.created_at AT TIME ZONE 'UTC')::date,
       m.message_id,m.id,
       CASE WHEN m.status='failed' THEN 'failed' ELSE 'sent' END,
       m.created_at,m.created_at
FROM public.messages m
JOIN public.conversations c ON c.id=m.conversation_id
JOIN public.whatsapp_config w ON w.account_id=c.account_id
WHERE m.sender_type <> 'customer'
  AND m.content_type <> 'template'
  AND m.message_id LIKE 'wamid.%'
  AND m.status <> 'failed'
  AND m.created_at >= date_trunc('month',timezone('utc',now())) AT TIME ZONE 'UTC'
ON CONFLICT DO NOTHING;

-- A first inbound message with a configured keyword but delayed/missing
-- referral evidence waits one minute before the normal opening flow starts.
-- The queue is durable across app restarts and service-role only.
CREATE TABLE IF NOT EXISTS public.whatsapp_keyword_openings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  meta_message_id text NOT NULL,
  message_text text NOT NULL,
  received_at timestamptz NOT NULL,
  run_at timestamptz NOT NULL,
  contact_created boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done','failed','cancelled')),
  claimed_at timestamptz,
  billing_resolution text CHECK (billing_resolution IS NULL OR billing_resolution IN ('confirmed','por_confirmar')),
  result text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (account_id, meta_message_id)
);
ALTER TABLE public.whatsapp_keyword_openings ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS whatsapp_keyword_openings_due
  ON public.whatsapp_keyword_openings(run_at) WHERE status='pending';
CREATE INDEX IF NOT EXISTS whatsapp_keyword_openings_claimed
  ON public.whatsapp_keyword_openings(claimed_at) WHERE status='running';
COMMENT ON TABLE public.whatsapp_keyword_openings IS 'Durable 60-second wait for configured first-message keywords while Meta referral evidence may still arrive.';

-- Backfill message windows from already stored, signed inbound webhook evidence.
WITH inbound_clock AS (
  SELECT conversation_id, max(created_at) AS last_customer_at
  FROM public.messages WHERE sender_type='customer' GROUP BY conversation_id
), first_ad AS (
  SELECT DISTINCT ON (conversation_id) conversation_id,source_referral,created_at
  FROM public.messages
  WHERE sender_type='customer' AND source_referral IS NOT NULL AND (
    nullif(source_referral->>'ctwa_clid','') IS NOT NULL OR
    (lower(coalesce(source_referral->>'source_type',''))='ad' AND
      nullif(coalesce(source_referral->>'source_id',source_referral->>'ad_id'),'') IS NOT NULL)
  )
  ORDER BY conversation_id,created_at,id
)
UPDATE public.conversations c SET
  last_customer_message_at=coalesce(c.last_customer_message_at,i.last_customer_at),
  first_ad_referral=coalesce(c.first_ad_referral,a.source_referral),
  first_ad_referral_at=coalesce(c.first_ad_referral_at,a.created_at)
FROM inbound_clock i LEFT JOIN first_ad a ON a.conversation_id=i.conversation_id
WHERE c.id=i.conversation_id;

CREATE OR REPLACE FUNCTION crm_private.record_whatsapp_billing_evidence() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE referral jsonb;
BEGIN
  IF current_user IN ('authenticated','anon') AND (
    (TG_OP='INSERT' AND (
      (NEW.billing_status IS NOT NULL AND NEW.billing_status <> 'unknown') OR NEW.billing_billable IS NOT NULL OR
      NEW.billing_type IS NOT NULL OR NEW.billing_category IS NOT NULL OR
      NEW.billing_model IS NOT NULL OR NEW.billing_confirmed_at IS NOT NULL OR
      NEW.billing_delivered_at IS NOT NULL OR NEW.billing_estimated_cost IS NOT NULL OR NEW.billing_currency IS NOT NULL OR
      NEW.source_referral IS NOT NULL
    )) OR (TG_OP='UPDATE' AND (
    NEW.billing_status IS DISTINCT FROM OLD.billing_status OR
    NEW.billing_billable IS DISTINCT FROM OLD.billing_billable OR
    NEW.billing_type IS DISTINCT FROM OLD.billing_type OR
    NEW.billing_category IS DISTINCT FROM OLD.billing_category OR
    NEW.billing_model IS DISTINCT FROM OLD.billing_model OR
    NEW.billing_confirmed_at IS DISTINCT FROM OLD.billing_confirmed_at OR
      NEW.billing_delivered_at IS DISTINCT FROM OLD.billing_delivered_at OR
    NEW.billing_estimated_cost IS DISTINCT FROM OLD.billing_estimated_cost OR
      NEW.billing_currency IS DISTINCT FROM OLD.billing_currency OR
      NEW.billing_phone_number_id IS DISTINCT FROM OLD.billing_phone_number_id OR
      NEW.billing_recipient_id IS DISTINCT FROM OLD.billing_recipient_id OR
      NEW.billing_sender IS DISTINCT FROM OLD.billing_sender OR
      NEW.source_referral IS DISTINCT FROM OLD.source_referral
    ))
  ) THEN
    RAISE EXCEPTION 'La clasificación de facturación procede del webhook firmado de Meta' USING ERRCODE='42501';
  END IF;

  IF NEW.sender_type='customer' AND NEW.source_referral IS NOT NULL THEN
    referral := NEW.source_referral;
  END IF;
  IF NEW.sender_type='customer' THEN
    UPDATE public.conversations SET
      last_customer_message_at=greatest(coalesce(last_customer_message_at,NEW.created_at),NEW.created_at),
      first_ad_referral=coalesce(first_ad_referral,CASE WHEN referral IS NOT NULL AND (
        nullif(referral->>'ctwa_clid','') IS NOT NULL OR
        (lower(coalesce(referral->>'source_type',''))='ad' AND
         nullif(coalesce(referral->>'source_id',referral->>'ad_id'),'') IS NOT NULL)
      ) THEN referral END),
      first_ad_referral_at=coalesce(first_ad_referral_at,CASE WHEN referral IS NOT NULL AND (
        nullif(referral->>'ctwa_clid','') IS NOT NULL OR
        (lower(coalesce(referral->>'source_type',''))='ad' AND
         nullif(coalesce(referral->>'source_id',referral->>'ad_id'),'') IS NOT NULL)
      ) THEN NEW.created_at END)
    WHERE id=NEW.conversation_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS messages_record_whatsapp_billing ON public.messages;
CREATE TRIGGER messages_record_whatsapp_billing
  BEFORE INSERT OR UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION crm_private.record_whatsapp_billing_evidence();

-- The deferred keyword fallback can only be set by the signed-webhook
-- queue worker. A browser must not be able to set it to bypass send checks.
CREATE OR REPLACE FUNCTION crm_private.protect_flow_billing_keyword_fallback() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF current_user IN ('authenticated','anon') AND NEW.billing_keyword_fallback IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'El permiso de apertura diferida solo lo fija el servidor' USING ERRCODE='42501';
  END IF;
  IF TG_OP='UPDATE' AND current_user IN ('authenticated','anon') AND
     NEW.billing_keyword_fallback IS DISTINCT FROM OLD.billing_keyword_fallback THEN
    RAISE EXCEPTION 'El permiso de apertura diferida solo lo fija el servidor' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS flow_runs_protect_billing_keyword_fallback ON public.flow_runs;
CREATE TRIGGER flow_runs_protect_billing_keyword_fallback
  BEFORE INSERT OR UPDATE ON public.flow_runs
  FOR EACH ROW EXECUTE FUNCTION crm_private.protect_flow_billing_keyword_fallback();

-- Authenticated campaign screens can create an unclassified recipient row,
-- but only Meta's verified delivery webhook may write billing evidence.
CREATE OR REPLACE FUNCTION crm_private.protect_broadcast_billing_evidence() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF current_user IN ('authenticated','anon') AND (
    (TG_OP='INSERT' AND (
      NEW.billing_status IS DISTINCT FROM 'unknown' OR NEW.billing_billable IS NOT NULL OR
      NEW.billing_type IS NOT NULL OR NEW.billing_category IS NOT NULL OR
      NEW.billing_model IS NOT NULL OR NEW.billing_confirmed_at IS NOT NULL OR
      NEW.billing_phone_number_id IS NOT NULL OR NEW.billing_recipient_id IS NOT NULL OR
      NEW.billing_estimated_cost IS NOT NULL OR NEW.billing_currency IS NOT NULL
    )) OR (TG_OP='UPDATE' AND (
      NEW.billing_status IS DISTINCT FROM OLD.billing_status OR
      NEW.billing_billable IS DISTINCT FROM OLD.billing_billable OR
      NEW.billing_type IS DISTINCT FROM OLD.billing_type OR
      NEW.billing_category IS DISTINCT FROM OLD.billing_category OR
      NEW.billing_model IS DISTINCT FROM OLD.billing_model OR
      NEW.billing_confirmed_at IS DISTINCT FROM OLD.billing_confirmed_at OR
      NEW.billing_phone_number_id IS DISTINCT FROM OLD.billing_phone_number_id OR
      NEW.billing_recipient_id IS DISTINCT FROM OLD.billing_recipient_id OR
      NEW.billing_estimated_cost IS DISTINCT FROM OLD.billing_estimated_cost OR
      NEW.billing_currency IS DISTINCT FROM OLD.billing_currency
    ))
  ) THEN
    RAISE EXCEPTION 'La clasificación de facturación procede del webhook firmado de Meta' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS broadcast_recipients_protect_billing ON public.broadcast_recipients;
CREATE TRIGGER broadcast_recipients_protect_billing
  BEFORE INSERT OR UPDATE ON public.broadcast_recipients
  FOR EACH ROW EXECUTE FUNCTION crm_private.protect_broadcast_billing_evidence();

-- Window/source clocks are server-side evidence. Browser sessions cannot
-- forge them or extend the free-entry period.
CREATE OR REPLACE FUNCTION crm_private.protect_whatsapp_conversation_billing_evidence() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF current_user IN ('authenticated','anon') AND (
    (TG_OP='INSERT' AND (
      NEW.last_customer_message_at IS NOT NULL OR
      NEW.first_ad_referral IS NOT NULL OR
      NEW.first_ad_referral_at IS NOT NULL
    )) OR (TG_OP='UPDATE' AND (
      NEW.last_customer_message_at IS DISTINCT FROM OLD.last_customer_message_at OR
      NEW.first_ad_referral IS DISTINCT FROM OLD.first_ad_referral OR
      NEW.first_ad_referral_at IS DISTINCT FROM OLD.first_ad_referral_at
    ))
  ) THEN
    RAISE EXCEPTION 'Las ventanas y referencias de WhatsApp proceden de webhooks verificados' USING ERRCODE='42501';
  END IF;

  IF TG_OP='UPDATE' AND OLD.first_ad_referral IS NOT NULL AND (
    NEW.first_ad_referral IS DISTINCT FROM OLD.first_ad_referral OR
    NEW.first_ad_referral_at IS DISTINCT FROM OLD.first_ad_referral_at
  ) THEN
    RAISE EXCEPTION 'La primera referencia publicitaria es inmutable' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS conversations_protect_whatsapp_billing_evidence ON public.conversations;
CREATE TRIGGER conversations_protect_whatsapp_billing_evidence
  BEFORE INSERT OR UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION crm_private.protect_whatsapp_conversation_billing_evidence();

COMMENT ON COLUMN public.messages.billing_status IS 'free/paid only when confirmed by Meta pricing.billable; unknown otherwise. Historical rows remain NULL when not captured.';
COMMENT ON COLUMN public.messages.billing_estimated_cost IS 'Estimated amount only; never populated without a verified rate card.';
COMMENT ON COLUMN public.conversations.first_ad_referral IS 'First click-to-WhatsApp ad referral from a signed Meta inbound webhook; write-once.';
COMMENT ON COLUMN public.broadcast_recipients.billing_status IS 'Meta-confirmed billing class for delivered broadcast templates; unknown until the signed Meta delivery webhook confirms pricing.';
