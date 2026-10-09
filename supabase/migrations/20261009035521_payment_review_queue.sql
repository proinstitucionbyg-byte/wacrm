-- Human payment decisions are separate from OCR evidence and WhatsApp delivery.
CREATE SCHEMA IF NOT EXISTS crm_private;
REVOKE ALL ON SCHEMA crm_private FROM PUBLIC;
GRANT USAGE ON SCHEMA crm_private TO authenticated, service_role;

CREATE TABLE public.payment_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  message_id uuid UNIQUE REFERENCES public.messages(id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','validated','rejected','observation')),
  origin text NOT NULL DEFAULT 'WHATSAPP',
  source_area text NOT NULL DEFAULT 'SIN AREA REGISTRADA',
  source_adviser text,
  evidence jsonb NOT NULL DEFAULT '{}',
  media_url text,
  note text CHECK (length(note) <= 2000),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz
);
CREATE INDEX payment_reviews_account_status ON public.payment_reviews(account_id,status,created_at DESC);
CREATE INDEX payment_reviews_contact ON public.payment_reviews(contact_id);
ALTER TABLE public.payment_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY payment_reviews_read ON public.payment_reviews FOR SELECT TO authenticated
  USING (public.is_account_member(account_id));
CREATE POLICY payment_reviews_owner_update ON public.payment_reviews FOR UPDATE TO authenticated
  USING (public.is_account_member(account_id,'owner'))
  WITH CHECK (public.is_account_member(account_id,'owner'));
REVOKE ALL ON public.payment_reviews FROM anon, authenticated;
GRANT SELECT ON public.payment_reviews TO authenticated;
GRANT UPDATE(status,note) ON public.payment_reviews TO authenticated;
GRANT ALL ON public.payment_reviews TO service_role;

CREATE TABLE public.payment_review_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id uuid NOT NULL REFERENCES public.payment_reviews(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  previous_status text NOT NULL,
  status text NOT NULL,
  note text,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_review_events_review ON public.payment_review_events(review_id,created_at);
ALTER TABLE public.payment_review_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY payment_review_events_read ON public.payment_review_events FOR SELECT TO authenticated
  USING (public.is_account_member(account_id,'owner'));
REVOKE ALL ON public.payment_review_events FROM anon, authenticated;
GRANT SELECT ON public.payment_review_events TO authenticated;
GRANT ALL ON public.payment_review_events TO service_role;

-- Private trigger helper: keeps contact labels consistent with ALL receipts,
-- so approving one receipt does not clear another pending receipt's label.
CREATE OR REPLACE FUNCTION crm_private.sync_payment_labels(target_contact uuid, target_account uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE item record; tag_uuid uuid; author_uuid uuid;
BEGIN
  IF target_contact IS NULL THEN RETURN; END IF;
  SELECT user_id INTO author_uuid FROM public.contacts WHERE id=target_contact AND account_id=target_account;
  IF author_uuid IS NULL THEN RETURN; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(target_account::text,0));
  FOR item IN SELECT * FROM (VALUES
    ('pending','PENDIENTE DE VALIDACION','#f59e0b'),
    ('validated','PAGO VALIDADO','#22c55e'),
    ('rejected','PAGO NO VALIDADO','#ef4444'),
    ('observation','PAGO EN OBSERVACION','#f97316')
  ) AS x(state,label,color) LOOP
    SELECT id INTO tag_uuid FROM public.tags WHERE account_id=target_account AND name=item.label ORDER BY created_at LIMIT 1;
    IF tag_uuid IS NULL THEN
      INSERT INTO public.tags(account_id,user_id,name,color) VALUES(target_account,author_uuid,item.label,item.color) RETURNING id INTO tag_uuid;
    END IF;
    IF EXISTS(SELECT 1 FROM public.payment_reviews WHERE contact_id=target_contact AND account_id=target_account AND status=item.state) THEN
      INSERT INTO public.contact_tags(contact_id,tag_id) VALUES(target_contact,tag_uuid) ON CONFLICT(contact_id,tag_id) DO NOTHING;
    ELSE
      DELETE FROM public.contact_tags WHERE contact_id=target_contact AND tag_id=tag_uuid;
    END IF;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION crm_private.sync_payment_labels(uuid,uuid) FROM PUBLIC, authenticated;

CREATE OR REPLACE FUNCTION crm_private.guard_payment_decision()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_account_member(OLD.account_id,'owner') THEN
    RAISE EXCEPTION 'Only the account owner may decide a payment' USING ERRCODE='42501';
  END IF;
  IF OLD.status='validated' THEN RAISE EXCEPTION 'Validated payment is locked'; END IF;
  IF NEW.status='pending' THEN RAISE EXCEPTION 'A human decision is required'; END IF;
  IF NEW.status IN ('rejected','observation') AND coalesce(btrim(NEW.note),'')='' THEN RAISE EXCEPTION 'Reason required'; END IF;
  IF (NEW.id,NEW.account_id,NEW.message_id,NEW.conversation_id,NEW.contact_id,NEW.origin,NEW.source_area,NEW.source_adviser,NEW.evidence,NEW.media_url,NEW.created_at)
     IS DISTINCT FROM
     (OLD.id,OLD.account_id,OLD.message_id,OLD.conversation_id,OLD.contact_id,OLD.origin,OLD.source_area,OLD.source_adviser,OLD.evidence,OLD.media_url,OLD.created_at) THEN
    RAISE EXCEPTION 'Payment evidence and origin cannot be rewritten';
  END IF;
  NEW.note=btrim(coalesce(NEW.note,''));
  NEW.version=OLD.version+1; NEW.reviewed_by=auth.uid(); NEW.reviewed_at=now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION crm_private.guard_payment_decision() FROM PUBLIC, authenticated;
CREATE TRIGGER payment_review_guard BEFORE UPDATE OF status,note ON public.payment_reviews
FOR EACH ROW EXECUTE FUNCTION crm_private.guard_payment_decision();

CREATE OR REPLACE FUNCTION crm_private.after_payment_review()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    IF (NEW.status,NEW.note,NEW.version) IS DISTINCT FROM (OLD.status,OLD.note,OLD.version) THEN
      INSERT INTO public.payment_review_events(review_id,account_id,previous_status,status,note,actor_id)
        VALUES(NEW.id,NEW.account_id,OLD.status,NEW.status,NEW.note,NEW.reviewed_by);
    END IF;
  END IF;
  PERFORM crm_private.sync_payment_labels(NEW.contact_id,NEW.account_id);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION crm_private.after_payment_review() FROM PUBLIC, authenticated;
CREATE TRIGGER payment_review_after AFTER INSERT OR UPDATE ON public.payment_reviews
FOR EACH ROW EXECUTE FUNCTION crm_private.after_payment_review();

-- Helper has no authenticated execute grant; only trusted triggers use it.
CREATE OR REPLACE FUNCTION crm_private.create_payment_review(target_message uuid, referring_user uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE m record; adviser record; result_id uuid;
BEGIN
  SELECT msg.*, c.account_id,c.contact_id,c.assigned_agent_id INTO m
    FROM public.messages msg JOIN public.conversations c ON c.id=msg.conversation_id
    WHERE msg.id=target_message AND msg.content_type='image' AND msg.sender_type='customer';
  IF NOT FOUND THEN RAISE EXCEPTION 'Inbound image not found'; END IF;
  SELECT full_name,nickname,area INTO adviser FROM public.profiles
    WHERE user_id=coalesce(referring_user,m.assigned_agent_id) AND account_id=m.account_id;
  INSERT INTO public.payment_reviews(account_id,message_id,conversation_id,contact_id,origin,source_area,source_adviser,evidence,media_url,created_at)
    VALUES(m.account_id,m.id,m.conversation_id,m.contact_id,
      CASE WHEN referring_user IS NULL THEN 'WHATSAPP' ELSE 'DERIVACION MANUAL' END,
      coalesce(nullif(upper(btrim(adviser.area)),''),'SIN AREA REGISTRADA'),
      coalesce(nullif(btrim(adviser.nickname),''),adviser.full_name),coalesce(m.image_analysis,'{}'),m.media_url,m.created_at)
    ON CONFLICT(message_id) DO NOTHING RETURNING id INTO result_id;
  IF result_id IS NULL THEN SELECT id INTO result_id FROM public.payment_reviews WHERE message_id=target_message; END IF;
  RETURN result_id;
END;
$$;
REVOKE ALL ON FUNCTION crm_private.create_payment_review(uuid,uuid) FROM PUBLIC, authenticated;

CREATE OR REPLACE FUNCTION crm_private.queue_inbound_receipt()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.sender_type='customer' AND NEW.content_type='image' AND NEW.image_analysis->>'category'='payment_receipt' THEN
    PERFORM crm_private.create_payment_review(NEW.id,NULL);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION crm_private.queue_inbound_receipt() FROM PUBLIC, authenticated;
CREATE TRIGGER queue_inbound_receipt AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION crm_private.queue_inbound_receipt();

CREATE OR REPLACE FUNCTION crm_private.refer_payment_for_review(target_message uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE account_uuid uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required' USING ERRCODE='42501'; END IF;
  SELECT c.account_id INTO account_uuid FROM public.messages m JOIN public.conversations c ON c.id=m.conversation_id
    WHERE m.id=target_message AND m.sender_type='customer' AND m.content_type='image';
  IF account_uuid IS NULL OR NOT public.is_account_member(account_uuid,'agent') THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501';
  END IF;
  RETURN crm_private.create_payment_review(target_message,auth.uid());
END;
$$;
REVOKE ALL ON FUNCTION crm_private.refer_payment_for_review(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm_private.refer_payment_for_review(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.refer_payment_for_review(target_message uuid)
RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT crm_private.refer_payment_for_review(target_message);
$$;
REVOKE ALL ON FUNCTION public.refer_payment_for_review(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refer_payment_for_review(uuid) TO authenticated;

-- Include existing extracted receipts without approving any of them.
DO $$ DECLARE item record; BEGIN
  FOR item IN SELECT id FROM public.messages WHERE sender_type='customer' AND content_type='image'
    AND image_analysis->>'category'='payment_receipt' LOOP
    PERFORM crm_private.create_payment_review(item.id,NULL);
  END LOOP;
END $$;
NOTIFY pgrst,'reload schema';
