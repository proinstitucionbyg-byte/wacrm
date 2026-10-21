CREATE OR REPLACE FUNCTION public.reserve_corrected_enrollment_document(
  p_enrollment_id uuid,
  p_account_id uuid,
  p_kind text,
  p_expected_sha256 text,
  p_replacement_sha256 text,
  p_media_id text,
  p_filename text,
  p_reason text,
  p_actor uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_delivery public.enrollment_document_deliveries%ROWTYPE;
  affected integer;
BEGIN
  IF p_kind <> 'CRONOGRAMA'
     OR p_expected_sha256 !~ '^[a-f0-9]{64}$'
     OR p_replacement_sha256 !~ '^[a-f0-9]{64}$'
     OR length(trim(p_reason)) < 10 THEN
    RAISE EXCEPTION 'Correccion de documento invalida';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.enrollment_drafts draft
    WHERE draft.id = p_enrollment_id
      AND draft.account_id = p_account_id
      AND draft.status = 'registered'
      AND draft.data->>'promotion_id' = 'OFERTA 19.90 + 5 CUOTAS 49.90'
      AND jsonb_array_length(COALESCE(draft.data->'correction_audit', '[]'::jsonb)) > 0
  ) THEN
    RAISE EXCEPTION 'La matricula no tiene una correccion de oferta comprobada';
  END IF;

  SELECT * INTO current_delivery
  FROM public.enrollment_document_deliveries
  WHERE enrollment_id = p_enrollment_id
    AND account_id = p_account_id
    AND kind = p_kind
    AND sha256 = p_expected_sha256
    AND status = 'sent'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La entrega anterior cambio; no se reenviara';
  END IF;

  INSERT INTO crm_private.enrollment_document_delivery_corrections(
    enrollment_id, account_id, kind, previous_sha256, previous_media_id,
    previous_filename, previous_whatsapp_message_id, previous_sent_at,
    replacement_sha256, reason, corrected_by
  ) VALUES (
    current_delivery.enrollment_id, current_delivery.account_id, current_delivery.kind,
    current_delivery.sha256, current_delivery.media_id, current_delivery.filename,
    current_delivery.whatsapp_message_id, current_delivery.sent_at,
    p_replacement_sha256, trim(p_reason), p_actor
  );

  UPDATE public.enrollment_document_deliveries
  SET sha256 = p_replacement_sha256,
      media_id = p_media_id,
      filename = p_filename,
      status = 'sending',
      whatsapp_message_id = NULL,
      sent_at = NULL,
      error = NULL
  WHERE enrollment_id = p_enrollment_id
    AND account_id = p_account_id
    AND kind = p_kind
    AND sha256 = p_expected_sha256
    AND status = 'sent';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN RAISE EXCEPTION 'No se pudo reservar la correccion'; END IF;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_corrected_enrollment_document(uuid, uuid, text, text, text, text, text, text, uuid)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_corrected_enrollment_document(uuid, uuid, text, text, text, text, text, text, uuid)
  TO service_role;

NOTIFY pgrst, 'reload schema';
