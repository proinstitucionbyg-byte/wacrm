-- Browser edits must return a draft to collecting, but the trusted intake
-- worker must be able to atomically save verified data and queue the draft.
CREATE OR REPLACE FUNCTION crm_private.guard_enrollment_data()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.status IN ('processing', 'registered') THEN
    RAISE EXCEPTION 'Matricula en proceso o registrada';
  END IF;
  IF jsonb_typeof(NEW.data) <> 'object' THEN
    RAISE EXCEPTION 'Datos invalidos';
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

REVOKE ALL ON FUNCTION crm_private.guard_enrollment_data() FROM PUBLIC, authenticated;
