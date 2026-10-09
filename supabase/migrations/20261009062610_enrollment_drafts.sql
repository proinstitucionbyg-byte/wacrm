CREATE TABLE public.enrollment_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  review_id uuid NOT NULL UNIQUE REFERENCES public.payment_reviews(id) ON DELETE RESTRICT,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  data jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'collecting' CHECK(status IN ('collecting','ready','processing','registered','error')),
  version integer NOT NULL DEFAULT 1,
  registered_number text, student_folder_url text, error text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  lease_token uuid, lease_until timestamptz
);
CREATE INDEX enrollment_account_state ON public.enrollment_drafts(account_id,status,created_at);
ALTER TABLE public.enrollment_drafts ENABLE ROW LEVEL SECURITY;
CREATE POLICY enrollment_read ON public.enrollment_drafts FOR SELECT TO authenticated USING(public.is_account_member(account_id));
CREATE POLICY enrollment_edit ON public.enrollment_drafts FOR UPDATE TO authenticated
  USING(public.is_account_member(account_id,'agent')) WITH CHECK(public.is_account_member(account_id,'agent'));
REVOKE ALL ON public.enrollment_drafts FROM anon,authenticated;
GRANT SELECT ON public.enrollment_drafts TO authenticated;
GRANT UPDATE(data) ON public.enrollment_drafts TO authenticated;
GRANT ALL ON public.enrollment_drafts TO service_role;

CREATE OR REPLACE FUNCTION crm_private.guard_enrollment_data() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF OLD.status IN ('processing','registered') THEN RAISE EXCEPTION 'Matricula en proceso o registrada'; END IF;
  IF jsonb_typeof(NEW.data) <> 'object' THEN RAISE EXCEPTION 'Datos invalidos'; END IF;
  NEW.version=OLD.version+1; NEW.updated_at=now(); NEW.updated_by=auth.uid(); NEW.status='collecting'; NEW.error=NULL;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION crm_private.guard_enrollment_data() FROM PUBLIC,authenticated;
CREATE TRIGGER guard_enrollment_data BEFORE UPDATE OF data ON public.enrollment_drafts FOR EACH ROW EXECUTE FUNCTION crm_private.guard_enrollment_data();

CREATE OR REPLACE FUNCTION crm_private.enrollment_after_payment() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NEW.status='validated' AND OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.enrollment_drafts(account_id,review_id,conversation_id,data)
      SELECT NEW.account_id,NEW.id,NEW.conversation_id,jsonb_build_object('phone1',coalesce(c.phone,'')) FROM public.contacts c WHERE c.id=NEW.contact_id
      ON CONFLICT(review_id) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION crm_private.enrollment_after_payment() FROM PUBLIC,authenticated;
CREATE TRIGGER enrollment_after_payment AFTER UPDATE OF status ON public.payment_reviews FOR EACH ROW EXECUTE FUNCTION crm_private.enrollment_after_payment();
-- Historical human decisions also receive a draft, without inventing student data.
INSERT INTO public.enrollment_drafts(account_id,review_id,conversation_id,data)
  SELECT r.account_id,r.id,r.conversation_id,jsonb_build_object('phone1',coalesce(c.phone,'')) FROM public.payment_reviews r JOIN public.contacts c ON c.id=r.contact_id
  WHERE r.status='validated' ON CONFLICT(review_id) DO NOTHING;
NOTIFY pgrst,'reload schema';
