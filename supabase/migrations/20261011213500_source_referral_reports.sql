ALTER TABLE public.messages ADD COLUMN source_referral jsonb CHECK(source_referral IS NULL OR (jsonb_typeof(source_referral)='object' AND octet_length(source_referral::text)<=10000));
CREATE INDEX messages_source_referral ON public.messages(conversation_id,created_at) WHERE source_referral IS NOT NULL;

-- Existing message history RLS still applies. Authenticated clients cannot forge webhook evidence.
CREATE FUNCTION crm_private.protect_source_referral() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF current_user IN ('authenticated','anon') AND (
  (TG_OP='INSERT' AND NEW.source_referral IS NOT NULL) OR
  (TG_OP='UPDATE' AND NEW.source_referral IS DISTINCT FROM OLD.source_referral)
 ) THEN RAISE EXCEPTION 'El origen debe proceder del webhook firmado' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER messages_referral_evidence BEFORE INSERT OR UPDATE ON public.messages FOR EACH ROW EXECUTE FUNCTION crm_private.protect_source_referral();

CREATE FUNCTION public.source_referral_report(p_start timestamptz,p_end timestamptz)
RETURNS TABLE(channel text,source_id text,source_type text,headline text,conversations bigint,validated_payments bigint,registered_enrollments bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE account uuid;
BEGIN
 SELECT p.account_id INTO account FROM public.profiles p WHERE p.user_id=auth.uid() AND p.account_role='owner';
 IF account IS NULL THEN RAISE EXCEPTION 'Reporte exclusivo del CEO' USING ERRCODE='42501'; END IF;
 IF p_start IS NULL OR p_end IS NULL OR p_end<=p_start OR p_end>p_start+interval '366 days' THEN RAISE EXCEPTION 'Periodo invalido' USING ERRCODE='22023'; END IF;
 RETURN QUERY
 WITH first_ref AS (
  SELECT DISTINCT ON (c.id) c.id,m.created_at,m.source_referral,coalesce(t.channel,'whatsapp') AS channel
  FROM public.messages m JOIN public.conversations c ON c.id=m.conversation_id JOIN public.contacts t ON t.id=c.contact_id
  WHERE c.account_id=account AND m.sender_type='customer' AND m.source_referral IS NOT NULL
  ORDER BY c.id,m.created_at,m.id
 ), attributed AS (
  SELECT f.*,coalesce(f.source_referral->>'source_id',f.source_referral->>'ad_id',f.source_referral->>'ref','SIN ID ENVIADO') AS source_id,
   coalesce(f.source_referral->>'source_type',f.source_referral->>'source','REFERENCIA') AS source_type,
   coalesce(f.source_referral->>'headline','SIN TITULO ENVIADO') AS headline,
   (SELECT count(*) FROM public.payment_reviews r WHERE r.account_id=account AND r.conversation_id=f.id AND r.status='validated' AND r.created_at>=f.created_at AND r.created_at<p_end) AS payments,
   (SELECT count(*) FROM public.enrollment_drafts d JOIN public.payment_reviews r ON r.id=d.review_id AND r.account_id=d.account_id WHERE d.account_id=account AND d.conversation_id=f.id AND d.status='registered' AND r.status='validated' AND d.created_at>=f.created_at AND d.created_at<p_end) AS enrollments
  FROM first_ref f WHERE f.created_at>=p_start AND f.created_at<p_end
 ) SELECT a.channel,a.source_id,a.source_type,a.headline,count(*),sum(a.payments)::bigint,sum(a.enrollments)::bigint FROM attributed a GROUP BY a.channel,a.source_id,a.source_type,a.headline ORDER BY count(*) DESC,a.source_id;
END $$;
REVOKE ALL ON FUNCTION public.source_referral_report(timestamptz,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.source_referral_report(timestamptz,timestamptz) TO authenticated;
