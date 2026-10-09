CREATE TABLE public.enrollment_document_deliveries (
  enrollment_id uuid NOT NULL REFERENCES public.enrollment_drafts(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK(kind IN ('BOLETA','CRONOGRAMA','FICHA')),
  sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'), media_id text NOT NULL,
  filename text NOT NULL, status text NOT NULL CHECK(status IN ('sending','sent','review')),
  whatsapp_message_id text, created_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz, error text,
  PRIMARY KEY(enrollment_id,kind)
);
ALTER TABLE public.enrollment_document_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.enrollment_document_deliveries FROM anon,authenticated;
GRANT SELECT ON public.enrollment_document_deliveries TO authenticated;
GRANT ALL ON public.enrollment_document_deliveries TO service_role;
CREATE POLICY enrollment_deliveries_read ON public.enrollment_document_deliveries FOR SELECT TO authenticated
  USING(public.is_account_member(account_id) AND public.has_member_permission(auth.uid(),'enrollments','view'));
NOTIFY pgrst,'reload schema';
