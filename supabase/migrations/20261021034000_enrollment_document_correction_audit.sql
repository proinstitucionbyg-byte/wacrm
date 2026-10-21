CREATE TABLE crm_private.enrollment_document_delivery_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id uuid NOT NULL REFERENCES public.enrollment_drafts(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('BOLETA', 'CRONOGRAMA', 'FICHA')),
  previous_sha256 text NOT NULL CHECK (previous_sha256 ~ '^[a-f0-9]{64}$'),
  previous_media_id text NOT NULL,
  previous_filename text NOT NULL,
  previous_whatsapp_message_id text,
  previous_sent_at timestamptz,
  replacement_sha256 text NOT NULL CHECK (replacement_sha256 ~ '^[a-f0-9]{64}$'),
  reason text NOT NULL CHECK (length(trim(reason)) >= 10),
  corrected_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  corrected_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (enrollment_id, kind, replacement_sha256)
);

ALTER TABLE crm_private.enrollment_document_delivery_corrections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm_private.enrollment_document_delivery_corrections FROM public, anon, authenticated;
GRANT ALL ON crm_private.enrollment_document_delivery_corrections TO service_role;

NOTIFY pgrst, 'reload schema';
