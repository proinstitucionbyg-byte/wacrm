-- Operational permissions are independent from access to the WhatsApp inbox.
INSERT INTO public.permission_definitions(module,action,label,description) VALUES
('payments','view','Ver validación de pagos','Acceder a la bandeja de comprobantes y sus decisiones'),
('payments','review','Validar o rechazar pagos','Tomar decisiones humanas sobre comprobantes; requiere Ver validación de pagos'),
('payments','refer','Derivar comprobantes','Enviar imágenes del chat a revisión sin aprobar pagos'),
('enrollments','view','Ver matrículas','Consultar fichas y documentos de matrícula'),
('enrollments','edit','Gestionar matrículas','Completar fichas y enviarlas a registro; requiere Ver matrículas')
ON CONFLICT(module,action) DO NOTHING;

-- Keep current agents' enrollment work. Payment access is NOT granted to agents.
INSERT INTO public.role_permissions(role,permission_id,allowed)
SELECT 'agent'::public.account_role_enum,id,true FROM public.permission_definitions
WHERE (module='enrollments' AND action IN ('view','edit')) OR (module='payments' AND action='refer')
ON CONFLICT(role,permission_id) DO NOTHING;

DROP POLICY payment_reviews_read ON public.payment_reviews;
CREATE POLICY payment_reviews_read ON public.payment_reviews FOR SELECT TO authenticated
USING(public.is_account_member(account_id) AND public.has_member_permission(auth.uid(),'payments','view'));
DROP POLICY payment_reviews_owner_update ON public.payment_reviews;
CREATE POLICY payment_reviews_authorized_update ON public.payment_reviews FOR UPDATE TO authenticated
USING(public.is_account_member(account_id) AND public.has_member_permission(auth.uid(),'payments','view') AND public.has_member_permission(auth.uid(),'payments','review'))
WITH CHECK(public.is_account_member(account_id) AND public.has_member_permission(auth.uid(),'payments','view') AND public.has_member_permission(auth.uid(),'payments','review'));
DROP POLICY payment_review_events_read ON public.payment_review_events;
CREATE POLICY payment_review_events_read ON public.payment_review_events FOR SELECT TO authenticated
USING(public.is_account_member(account_id) AND public.has_member_permission(auth.uid(),'payments','view'));

CREATE OR REPLACE FUNCTION crm_private.guard_payment_decision()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_account_member(OLD.account_id)
    OR NOT public.has_member_permission(auth.uid(),'payments','view')
    OR NOT public.has_member_permission(auth.uid(),'payments','review') THEN
    RAISE EXCEPTION 'Payment decision permission required' USING ERRCODE='42501';
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

CREATE OR REPLACE FUNCTION crm_private.refer_payment_for_review(target_message uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE account_uuid uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required' USING ERRCODE='42501'; END IF;
  SELECT c.account_id INTO account_uuid FROM public.messages m JOIN public.conversations c ON c.id=m.conversation_id
    WHERE m.id=target_message AND m.sender_type='customer' AND m.content_type='image';
  IF account_uuid IS NULL OR NOT public.is_account_member(account_uuid,'agent')
    OR NOT public.has_member_permission(auth.uid(),'payments','refer') THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501';
  END IF;
  RETURN crm_private.create_payment_review(target_message,auth.uid());
END;
$$;

DROP POLICY enrollment_read ON public.enrollment_drafts;
CREATE POLICY enrollment_read ON public.enrollment_drafts FOR SELECT TO authenticated
USING(public.is_account_member(account_id) AND public.has_member_permission(auth.uid(),'enrollments','view'));
DROP POLICY enrollment_edit ON public.enrollment_drafts;
CREATE POLICY enrollment_edit ON public.enrollment_drafts FOR UPDATE TO authenticated
USING(public.is_account_member(account_id) AND public.has_member_permission(auth.uid(),'enrollments','view') AND public.has_member_permission(auth.uid(),'enrollments','edit'))
WITH CHECK(public.is_account_member(account_id) AND public.has_member_permission(auth.uid(),'enrollments','view') AND public.has_member_permission(auth.uid(),'enrollments','edit'));

NOTIFY pgrst,'reload schema';
