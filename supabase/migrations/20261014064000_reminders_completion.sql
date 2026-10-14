-- Personal reminders are actionable notices. Reading is separate from doing.
CREATE OR REPLACE FUNCTION crm_private.classify_system_task()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  NEW.requires_action = NEW.type = 'system_notice' AND (
    NEW.dedup_key LIKE 'start:%'
    OR NEW.dedup_key LIKE 'calendar:%'
    OR NEW.dedup_key LIKE 'payment-followup:%'
    OR NEW.dedup_key LIKE 'adviser-reminder:%'
  );
  RETURN NEW;
END $$;

UPDATE public.notifications
SET requires_action = true
WHERE type = 'system_notice'
  AND dedup_key LIKE 'adviser-reminder:%'
  AND requires_action = false;
