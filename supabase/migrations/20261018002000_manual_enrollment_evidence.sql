CREATE TABLE public.enrollment_uploads (
  id uuid PRIMARY KEY, account_id uuid NOT NULL REFERENCES public.accounts(id),
  review_id uuid NOT NULL REFERENCES public.payment_reviews(id),
  kind text NOT NULL CHECK(kind IN ('front','back','voucher','declaration','guardian')),
  storage_path text NOT NULL UNIQUE, mime_type text NOT NULL,
  image_analysis jsonb, uploaded_by uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.enrollment_uploads ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.enrollment_uploads TO authenticated;
GRANT ALL ON public.enrollment_uploads TO service_role;
CREATE POLICY enrollment_uploads_read ON public.enrollment_uploads FOR SELECT TO authenticated USING(
  public.is_account_member(account_id) AND (public.has_member_permission(auth.uid(),'enrollments','view') OR public.has_member_permission(auth.uid(),'payments','view')));
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES('enrollment-evidence','enrollment-evidence',false,10485760,ARRAY['image/jpeg','image/png','image/webp']) ON CONFLICT(id) DO NOTHING;
ALTER TABLE public.payment_reviews ADD COLUMN voucher_upload_id uuid REFERENCES public.enrollment_uploads(id);
ALTER TABLE public.payment_reviews ADD COLUMN manual_request_key uuid;
CREATE UNIQUE INDEX payment_manual_request ON public.payment_reviews(account_id,manual_request_key) WHERE manual_request_key IS NOT NULL;
CREATE FUNCTION public.create_manual_enrollment(p_account uuid,p_actor uuid,p_conversation uuid,p_data jsonb,p_uploads jsonb,p_sales_agent uuid,p_request_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE review_uuid uuid; draft_uuid uuid; adviser text; conversation public.conversations; upload jsonb; voucher jsonb;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE user_id=p_actor AND account_id=p_account)
    OR NOT public.has_member_permission(p_actor,'enrollments','edit') THEN RAISE EXCEPTION 'Acceso a matriculas requerido'; END IF;
  IF p_request_key IS NULL THEN RAISE EXCEPTION 'Identificador de ingreso requerido'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_account::text||p_request_key::text,0));
  SELECT r.id,e.id INTO review_uuid,draft_uuid FROM public.payment_reviews r JOIN public.enrollment_drafts e ON e.review_id=r.id WHERE r.account_id=p_account AND r.manual_request_key=p_request_key;
  IF draft_uuid IS NOT NULL THEN RETURN jsonb_build_object('review_id',review_uuid,'draft_id',draft_uuid,'reused',true); END IF;
  SELECT * INTO conversation FROM public.conversations WHERE id=p_conversation AND account_id=p_account;
  IF conversation.id IS NULL THEN RAISE EXCEPTION 'Conversacion no disponible'; END IF;
  SELECT coalesce(nullif(nickname,''),full_name) INTO adviser FROM public.profiles WHERE user_id=p_sales_agent AND account_id=p_account AND (upper(area)='VENTAS' OR account_role='owner');
  IF nullif(btrim(adviser),'') IS NULL THEN RAISE EXCEPTION 'Selecciona la asesora que realizo la venta'; END IF;
  SELECT x INTO voucher FROM jsonb_array_elements(p_uploads) x WHERE x->>'kind'='voucher';
  IF voucher IS NULL OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_uploads) x WHERE x->>'kind' IN ('front','declaration')) THEN RAISE EXCEPTION 'Faltan voucher o respaldo de identidad'; END IF;
  INSERT INTO public.payment_reviews(account_id,conversation_id,contact_id,origin,source_area,source_adviser,sales_adviser,evidence,payment_purpose,media_url,manual_request_key)
    VALUES(p_account,p_conversation,conversation.contact_id,'CRM MANUAL','INGRESO MANUAL',adviser,adviser,coalesce(voucher->'image_analysis','{}'),'enrollment','/api/enrollments/uploads/'||(voucher->>'id'),p_request_key) RETURNING id INTO review_uuid;
  FOR upload IN SELECT * FROM jsonb_array_elements(p_uploads) LOOP
    IF left(upload->>'storage_path',length(p_account::text)+1)<>p_account::text||'/' THEN RAISE EXCEPTION 'Archivo de otra cuenta'; END IF;
    INSERT INTO public.enrollment_uploads(id,account_id,review_id,kind,storage_path,mime_type,image_analysis,uploaded_by)
      VALUES((upload->>'id')::uuid,p_account,review_uuid,upload->>'kind',upload->>'storage_path',upload->>'mime_type',upload->'image_analysis',p_actor);
  END LOOP;
  -- The ordinary decision guard does not apply: only insert the pending case and draft here.
  INSERT INTO public.enrollment_drafts(account_id,review_id,conversation_id,data,sales_adviser)
    VALUES(p_account,review_uuid,p_conversation,p_data,adviser) RETURNING id INTO draft_uuid;
  RETURN jsonb_build_object('review_id',review_uuid,'draft_id',draft_uuid);
END $$;
DO $$ DECLARE definition text; BEGIN
  definition=pg_get_functiondef('crm_private.enrollment_after_payment()'::regprocedure);
  definition=replace(definition,'ON CONFLICT(review_id) DO NOTHING;',E'ON CONFLICT(review_id) DO NOTHING;\n      INSERT INTO public.incomplete_intake_watches(enrollment_id,account_id,conversation_id,welcome_due_at) SELECT id,account_id,conversation_id,NEW.reviewed_at+interval ''2 hours'' FROM public.enrollment_drafts WHERE review_id=NEW.id AND conversation_id IS NOT NULL ON CONFLICT DO NOTHING;');
  EXECUTE definition;
END $$;
REVOKE ALL ON FUNCTION public.create_manual_enrollment(uuid,uuid,uuid,jsonb,jsonb,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_manual_enrollment(uuid,uuid,uuid,jsonb,jsonb,uuid,uuid) TO service_role;
DO $$ DECLARE definition text; BEGIN
  definition=pg_get_functiondef('crm_private.capture_payment_sales_adviser()'::regprocedure);
  definition=replace(definition,'BEGIN',E'BEGIN\n  IF NEW.origin=''CRM MANUAL'' AND NEW.message_id IS NULL THEN RETURN NEW; END IF;');
  EXECUTE definition;
END $$;
