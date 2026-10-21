CREATE TABLE crm_private.enrollment_offer_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id uuid NOT NULL REFERENCES public.enrollment_drafts(id) ON DELETE RESTRICT,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
  previous_promotion text NOT NULL,
  corrected_promotion text NOT NULL,
  previous_prices jsonb NOT NULL,
  corrected_prices jsonb NOT NULL,
  reason text NOT NULL,
  corrected_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON crm_private.enrollment_offer_corrections FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION crm_private.guard_enrollment_data()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  registered_correction boolean :=
    current_setting('crm.registered_offer_correction', true) = '1'
    AND (auth.role() = 'service_role' OR session_user = 'postgres');
BEGIN
  IF OLD.status = 'processing' THEN
    RAISE EXCEPTION 'Matricula en proceso';
  END IF;
  IF OLD.status = 'registered' AND NOT registered_correction THEN
    RAISE EXCEPTION 'Matricula registrada';
  END IF;
  IF jsonb_typeof(NEW.data) <> 'object' THEN
    RAISE EXCEPTION 'Datos invalidos';
  END IF;

  IF OLD.status = 'registered' THEN
    IF (NEW.data - 'prices' - 'promotion_id' - 'correction_audit')
       IS DISTINCT FROM
       (OLD.data - 'prices' - 'promotion_id' - 'correction_audit') THEN
      RAISE EXCEPTION 'La correccion solo puede cambiar la promocion registrada';
    END IF;
    NEW.version = OLD.version + 1;
    NEW.updated_at = now();
    NEW.updated_by = auth.uid();
    NEW.error = NULL;
    NEW.status = OLD.status;
    RETURN NEW;
  END IF;

  NEW.version = OLD.version + 1;
  NEW.updated_at = now();
  NEW.updated_by = auth.uid();
  NEW.error = NULL;

  IF auth.role() = 'service_role'
     AND OLD.status IN ('collecting', 'error')
     AND NEW.status = 'ready' THEN
    NEW.status = 'ready';
  ELSE
    NEW.status = 'collecting';
  END IF;

  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION crm_private.guard_enrollment_data() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.correct_registered_enrollment_offer(
  p_enrollment_id uuid,
  p_account_id uuid,
  p_expected_promotion text,
  p_corrected_promotion text,
  p_corrected_prices jsonb,
  p_reason text,
  p_actor uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_row public.enrollment_drafts%ROWTYPE;
  updated_row public.enrollment_drafts%ROWTYPE;
  audit_entry jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND session_user <> 'postgres' THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;
  IF length(trim(coalesce(p_reason, ''))) < 10 THEN
    RAISE EXCEPTION 'Motivo de correccion insuficiente';
  END IF;
  IF jsonb_typeof(p_corrected_prices) <> 'array'
     OR jsonb_array_length(p_corrected_prices) <> 6
     OR EXISTS (
       SELECT 1
       FROM jsonb_array_elements(p_corrected_prices) value
       WHERE jsonb_typeof(value) <> 'number' OR (value #>> '{}')::numeric <= 0
     ) THEN
    RAISE EXCEPTION 'Precios corregidos invalidos';
  END IF;

  SELECT * INTO current_row
  FROM public.enrollment_drafts
  WHERE id = p_enrollment_id AND account_id = p_account_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Matricula no encontrada'; END IF;
  IF current_row.status <> 'registered' THEN RAISE EXCEPTION 'La matricula no esta registrada'; END IF;
  IF current_row.data->>'promotion_id' IS DISTINCT FROM p_expected_promotion THEN
    RAISE EXCEPTION 'La promocion actual cambio; recarga antes de corregir';
  END IF;

  audit_entry = jsonb_build_object(
    'at', now(),
    'reason', trim(p_reason),
    'previous_promotion', current_row.data->>'promotion_id',
    'corrected_promotion', p_corrected_promotion,
    'actor', p_actor
  );

  PERFORM set_config('crm.registered_offer_correction', '1', true);
  UPDATE public.enrollment_drafts
  SET data = jsonb_set(
    jsonb_set(
      jsonb_set(data, '{prices}', p_corrected_prices, true),
      '{promotion_id}', to_jsonb(p_corrected_promotion), true
    ),
    '{correction_audit}',
    coalesce(data->'correction_audit', '[]'::jsonb) || jsonb_build_array(audit_entry),
    true
  )
  WHERE id = p_enrollment_id AND account_id = p_account_id
  RETURNING * INTO updated_row;

  INSERT INTO crm_private.enrollment_offer_corrections (
    enrollment_id, account_id, previous_promotion, corrected_promotion,
    previous_prices, corrected_prices, reason, corrected_by
  ) VALUES (
    current_row.id, current_row.account_id, current_row.data->>'promotion_id',
    p_corrected_promotion, current_row.data->'prices', p_corrected_prices,
    trim(p_reason), p_actor
  );

  RETURN jsonb_build_object(
    'id', updated_row.id,
    'version', updated_row.version,
    'status', updated_row.status,
    'data', updated_row.data
  );
END
$$;

REVOKE ALL ON FUNCTION public.correct_registered_enrollment_offer(uuid, uuid, text, text, jsonb, text, uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.correct_registered_enrollment_offer(uuid, uuid, text, text, jsonb, text, uuid)
TO service_role;
