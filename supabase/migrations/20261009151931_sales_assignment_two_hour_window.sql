-- Local batch: apply together with the send endpoint, cron and Google bridge.
ALTER TABLE public.conversation_sales_routes
  DROP CONSTRAINT conversation_sales_routes_state_check,
  ADD CONSTRAINT conversation_sales_routes_state_check CHECK(state IN ('waiting','assigned','expired')),
  ADD COLUMN lease_started_at timestamptz,
  ADD COLUMN lease_expires_at timestamptz,
  ADD COLUMN last_agent_message_at timestamptz,
  ADD COLUMN last_agent_message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  ADD COLUMN assignment_tag_id uuid REFERENCES public.tags(id) ON DELETE SET NULL;
CREATE INDEX sales_assignment_due ON public.conversation_sales_routes(lease_expires_at) WHERE state='assigned';

-- Existing assignments get a fresh window, never inferred historical commission.
UPDATE public.conversation_sales_routes SET lease_started_at=now(),lease_expires_at=now()+interval '2 hours' WHERE state='assigned';

-- Called only by the server after an authenticated adviser's successful send.
-- Lock conversation before route consistently with inbound routing/expiry.
CREATE FUNCTION crm_private.record_sales_agent_message(p_message_id uuid,p_user_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m record; conv record; route public.conversation_sales_routes; sent_at timestamptz;
BEGIN
  SELECT * INTO m FROM public.messages WHERE id=p_message_id AND sender_type='agent'
    AND sender_id=p_user_id AND status IN ('sent','delivered','read');
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO conv FROM public.conversations WHERE id=m.conversation_id FOR NO KEY UPDATE;
  IF NOT FOUND OR NOT public.has_member_permission(p_user_id,'inbox','send') OR NOT EXISTS(
    SELECT 1 FROM public.profiles WHERE user_id=p_user_id AND account_id=conv.account_id
  ) THEN RETURN false; END IF;
  sent_at=least(m.created_at,now());
  UPDATE public.conversations SET last_human_message_at=greatest(last_human_message_at,sent_at) WHERE id=conv.id;
  SELECT * INTO route FROM public.conversation_sales_routes WHERE conversation_id=conv.id FOR UPDATE;
  IF NOT FOUND OR route.state<>'assigned' OR route.agent_id IS DISTINCT FROM p_user_id
    OR conv.assigned_agent_id IS DISTINCT FROM p_user_id OR route.lease_expires_at<=sent_at
    OR sent_at<route.lease_started_at OR sent_at<=route.last_agent_message_at THEN RETURN false; END IF;
  UPDATE public.conversation_sales_routes SET last_agent_message_at=sent_at,last_agent_message_id=m.id,
    lease_expires_at=sent_at+interval '2 hours' WHERE conversation_id=conv.id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION crm_private.record_sales_agent_message(uuid,uuid) FROM PUBLIC,anon,authenticated;
-- Only the private message trigger calls the renewal function.

-- The successful message INSERT and its renewal commit together. A receipt
-- arriving immediately afterwards cannot race a second HTTP/RPC round trip.
CREATE FUNCTION crm_private.track_sales_agent_message() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NEW.sender_type='agent' AND NEW.sender_id=auth.uid() THEN
    PERFORM crm_private.record_sales_agent_message(NEW.id,NEW.sender_id);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION crm_private.track_sales_agent_message() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER track_sales_agent_message AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION crm_private.track_sales_agent_message();

CREATE FUNCTION crm_private.expire_sales_assignment(p_conversation_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE conv record; route public.conversation_sales_routes;
BEGIN
    SELECT * INTO conv FROM public.conversations WHERE id=p_conversation_id FOR NO KEY UPDATE SKIP LOCKED;
    IF NOT FOUND THEN RETURN false; END IF;
    SELECT * INTO route FROM public.conversation_sales_routes WHERE conversation_id=conv.id FOR UPDATE;
    -- Recheck under lock: an adviser may have renewed while cron was waiting.
    IF NOT FOUND OR route.state<>'assigned' OR route.lease_expires_at>now() THEN RETURN false; END IF;
    IF conv.assigned_agent_id=route.agent_id THEN
      UPDATE public.conversations SET assigned_agent_id=NULL,updated_at=now() WHERE id=conv.id;
    END IF;
    UPDATE public.conversation_sales_routes SET state='expired' WHERE conversation_id=conv.id;
    -- A label is contact-wide. Preserve it if another active conversation needs it.
    DELETE FROM public.contact_tags ct WHERE ct.contact_id=conv.contact_id AND ct.tag_id=route.assignment_tag_id
      AND NOT EXISTS(SELECT 1 FROM public.conversation_sales_routes r JOIN public.conversations c ON c.id=r.conversation_id
        WHERE c.contact_id=conv.contact_id AND r.state='assigned' AND r.assignment_tag_id=ct.tag_id);
    -- Do not change explicit manual AI/automation controls.
    RETURN true;
END $$;
REVOKE ALL ON FUNCTION crm_private.expire_sales_assignment(uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.expire_sales_assignments()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE candidate record; total integer=0;
BEGIN
  FOR candidate IN SELECT conversation_id FROM public.conversation_sales_routes
    WHERE state='assigned' AND lease_expires_at<=now() ORDER BY lease_expires_at LIMIT 500 LOOP
    IF crm_private.expire_sales_assignment(candidate.conversation_id) THEN total=total+1; END IF;
  END LOOP;
  RETURN total;
END $$;
REVOKE ALL ON FUNCTION public.expire_sales_assignments() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.expire_sales_assignments() TO service_role;

-- Freeze attribution on arrival, before asynchronous OCR or CEO validation.
-- Keep it private so editing a message/data JSON cannot change commission.
CREATE TABLE crm_private.message_sales_attribution (
  message_id uuid PRIMARY KEY REFERENCES public.messages(id) ON DELETE CASCADE,
  sales_adviser text NOT NULL,
  agent_id uuid,
  captured_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE crm_private.message_sales_attribution ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm_private.message_sales_attribution FROM PUBLIC,anon,authenticated;
CREATE FUNCTION crm_private.capture_message_sales_attribution() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE conv record; route public.conversation_sales_routes; adviser text; responsible uuid;
BEGIN
  IF NEW.sender_type<>'customer' THEN RETURN NEW; END IF;
  SELECT * INTO conv FROM public.conversations WHERE id=NEW.conversation_id FOR NO KEY UPDATE;
  SELECT * INTO route FROM public.conversation_sales_routes WHERE conversation_id=conv.id;
  IF route.state='assigned' AND route.agent_id=conv.assigned_agent_id
    AND NEW.created_at>=route.lease_started_at AND NEW.created_at<route.lease_expires_at
    AND route.last_agent_message_at IS NOT NULL AND route.last_agent_message_at<=NEW.created_at THEN
    SELECT upper(coalesce(nullif(btrim(nickname),''),nullif(btrim(full_name),''))) INTO adviser
      FROM public.profiles WHERE user_id=route.agent_id AND account_id=conv.account_id;
    responsible=route.agent_id;
  END IF;
  INSERT INTO crm_private.message_sales_attribution(message_id,sales_adviser,agent_id)
    VALUES(NEW.id,coalesce(adviser,'INSTITUCION'),responsible);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION crm_private.capture_message_sales_attribution() FROM PUBLIC,anon,authenticated;
-- Alphabetically before queue_inbound_receipt, whose review INSERT reads this snapshot.
CREATE TRIGGER capture_message_sales_attribution AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION crm_private.capture_message_sales_attribution();

ALTER TABLE public.payment_reviews ADD COLUMN sales_adviser text;
ALTER TABLE public.enrollment_drafts ADD COLUMN sales_adviser text;
CREATE FUNCTION crm_private.capture_payment_sales_adviser() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  SELECT sales_adviser INTO NEW.sales_adviser FROM crm_private.message_sales_attribution WHERE message_id=NEW.message_id;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION crm_private.capture_payment_sales_adviser() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER capture_payment_sales_adviser BEFORE INSERT ON public.payment_reviews
  FOR EACH ROW EXECUTE FUNCTION crm_private.capture_payment_sales_adviser();

CREATE OR REPLACE FUNCTION crm_private.enrollment_after_payment() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NEW.status='validated' AND OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.enrollment_drafts(account_id,review_id,conversation_id,data,sales_adviser)
      SELECT NEW.account_id,NEW.id,NEW.conversation_id,jsonb_build_object('phone1',coalesce(c.phone,'')),NEW.sales_adviser
      FROM public.contacts c WHERE c.id=NEW.contact_id ON CONFLICT(review_id) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION crm_private.enrollment_after_payment() FROM PUBLIC,anon,authenticated;
-- Existing reviews/drafts intentionally remain NULL; do not guess old attribution.


CREATE OR REPLACE FUNCTION public.route_sales_conversation(p_account_id uuid,p_conversation_id uuid,p_message_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cfg public.account_sales_routing; conv record; inbound record; turns integer; chosen uuid; weight_total integer;
  pool uuid[]; route_exists boolean; tag_uuid uuid; item record; author_uuid uuid; adviser_name text;
BEGIN
  SELECT * INTO cfg FROM public.account_sales_routing WHERE account_id=p_account_id FOR UPDATE;
  IF NOT FOUND OR NOT cfg.enabled THEN RETURN jsonb_build_object('handled',false); END IF;
  SELECT * INTO conv FROM public.conversations WHERE id=p_conversation_id AND account_id=p_account_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('handled',false); END IF;
  PERFORM crm_private.expire_sales_assignment(conv.id);
  SELECT EXISTS(SELECT 1 FROM public.conversation_sales_routes WHERE conversation_id=conv.id) INTO route_exists;
  IF EXISTS(SELECT 1 FROM public.conversation_sales_routes WHERE conversation_id=conv.id AND state='expired') THEN RETURN jsonb_build_object('handled',false); END IF;
  IF conv.automation_enabled=false AND NOT route_exists THEN RETURN jsonb_build_object('handled',false); END IF;
  IF conv.assigned_agent_id IS NOT NULL THEN RETURN jsonb_build_object('handled',route_exists,'notify',false); END IF;
  SELECT id,created_at INTO inbound FROM public.messages WHERE conversation_id=conv.id AND message_id=p_message_id AND sender_type='customer';
  IF NOT FOUND THEN RETURN jsonb_build_object('handled',false); END IF;
  SELECT count(*) INTO turns FROM (
    SELECT sender_type,lag(sender_type) OVER(ORDER BY created_at,id) AS previous_sender
    FROM public.messages WHERE conversation_id=conv.id AND created_at>=cfg.started_at AND created_at<=inbound.created_at
  ) AS ordered WHERE sender_type='bot' AND previous_sender IS DISTINCT FROM 'bot';
  IF turns<4 THEN RETURN jsonb_build_object('handled',false,'turns',turns); END IF;
  SELECT array_agg(r.user_id),sum(r.percentage) INTO pool,weight_total FROM public.member_sales_routing r
    JOIN public.profiles p ON p.user_id=r.user_id AND p.account_id=r.account_id
    JOIN public.member_presence presence ON presence.user_id=r.user_id AND presence.account_id=r.account_id
    WHERE r.account_id=p_account_id AND r.percentage>0 AND lower(p.area)='ventas' AND p.account_role<>'viewer'
      AND presence.status='online' AND presence.last_seen_at>=now()-interval '75 seconds'
      AND public.has_member_permission(p.user_id,'inbox','view') AND public.has_member_permission(p.user_id,'inbox','send');
  IF coalesce(weight_total,0)>0 THEN
    UPDATE public.member_sales_routing SET current_weight=current_weight+percentage WHERE account_id=p_account_id AND user_id=ANY(pool);
    SELECT user_id INTO chosen FROM public.member_sales_routing WHERE account_id=p_account_id AND user_id=ANY(pool) ORDER BY current_weight DESC,user_id LIMIT 1;
    UPDATE public.member_sales_routing SET current_weight=current_weight-weight_total WHERE account_id=p_account_id AND user_id=chosen;
  END IF;
  -- Assignment exposes the lead to its adviser; it is not a human takeover.
  -- Preserve AI/automation flags, scheduled executions and the active flow.
  UPDATE public.conversations SET assigned_agent_id=chosen,updated_at=now() WHERE id=conv.id;
  INSERT INTO public.conversation_sales_routes(conversation_id,account_id,agent_id,state) VALUES(conv.id,p_account_id,chosen,CASE WHEN chosen IS NULL THEN 'waiting' ELSE 'assigned' END)
    ON CONFLICT(conversation_id) DO UPDATE SET agent_id=EXCLUDED.agent_id,state=EXCLUDED.state;
  UPDATE public.conversation_sales_routes SET lease_started_at=now(),lease_expires_at=now()+interval '2 hours',last_agent_message_at=NULL,last_agent_message_id=NULL WHERE conversation_id=conv.id AND chosen IS NOT NULL;
  SELECT user_id INTO author_uuid FROM public.contacts WHERE id=conv.contact_id AND account_id=p_account_id;
  SELECT coalesce(nullif(btrim(nickname),''),full_name) INTO adviser_name FROM public.profiles WHERE user_id=chosen AND account_id=p_account_id;
  IF author_uuid IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_account_id::text,0));
    FOR item IN SELECT * FROM (VALUES ('AREA VENTAS','#0ea5e9'),
      (CASE WHEN chosen IS NULL THEN 'PENDIENTE DE ASIGNACION VENTAS' ELSE 'AREA VENTAS' END,'#8b5cf6')) AS x(label,color) LOOP
      SELECT id INTO tag_uuid FROM public.tags WHERE account_id=p_account_id AND name=item.label ORDER BY created_at LIMIT 1;
      IF tag_uuid IS NULL THEN INSERT INTO public.tags(account_id,user_id,name,color) VALUES(p_account_id,author_uuid,item.label,item.color) RETURNING id INTO tag_uuid; END IF;

      INSERT INTO public.contact_tags(contact_id,tag_id) VALUES(conv.contact_id,tag_uuid) ON CONFLICT DO NOTHING;
    END LOOP;
    IF chosen IS NOT NULL THEN DELETE FROM public.contact_tags ct USING public.tags t WHERE ct.tag_id=t.id AND ct.contact_id=conv.contact_id AND t.account_id=p_account_id AND t.name='PENDIENTE DE ASIGNACION VENTAS'; END IF;
  END IF;
  RETURN jsonb_build_object('handled',true,'assigned',chosen IS NOT NULL,'agent_id',chosen,'notify',NOT route_exists OR chosen IS NOT NULL);
END $$;
REVOKE ALL ON FUNCTION public.route_sales_conversation(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.route_sales_conversation(uuid,uuid,text) TO service_role;
NOTIFY pgrst,'reload schema';
