-- Keep personal notifications unchanged; scheduled WhatsApp sends use the
-- same reminder ownership but are claimed once before any external send.
ALTER TABLE public.adviser_reminders
  ADD COLUMN action_kind text NOT NULL DEFAULT 'notification'
    CHECK (action_kind IN ('notification', 'message')),
  ADD COLUMN destination_phone text,
  ADD COLUMN message_text text,
  ADD COLUMN dispatch_claimed_at timestamptz,
  ADD COLUMN dispatch_error text;

ALTER TABLE public.adviser_reminders DROP CONSTRAINT adviser_reminders_status_check;
ALTER TABLE public.adviser_reminders ADD CONSTRAINT adviser_reminders_status_check
  CHECK (status IN ('active', 'done', 'dispatching', 'blocked'));
ALTER TABLE public.adviser_reminders ADD CONSTRAINT adviser_reminders_message_action_check
  CHECK (action_kind = 'notification' OR
    (conversation_id IS NOT NULL AND destination_phone IS NOT NULL
     AND destination_phone ~ '^9[0-9]{8}$' AND message_text IS NOT NULL
     AND length(btrim(message_text)) BETWEEN 1 AND 1000 AND repeat_days IS NULL));
CREATE INDEX adviser_reminders_dispatch_claim_idx ON public.adviser_reminders(dispatch_claimed_at)
  WHERE action_kind = 'message' AND status = 'dispatching';

-- The UI has create/cancel only. Only the trusted worker may change a job
-- state; an authenticated browser must not re-open a completed send.
REVOKE UPDATE ON public.adviser_reminders FROM authenticated;
DROP POLICY adviser_reminders_edit ON public.adviser_reminders;
DROP POLICY adviser_reminders_remove ON public.adviser_reminders;
CREATE POLICY adviser_reminders_remove ON public.adviser_reminders FOR DELETE TO authenticated
  USING (user_id = auth.uid() AND public.is_account_member(account_id)
    AND status <> 'dispatching');

-- The existing personal-notification publisher must leave message jobs for
-- the application worker; otherwise it would mark them done without sending.
CREATE OR REPLACE FUNCTION public.publish_due_adviser_reminders()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  item public.adviser_reminders%ROWTYPE;
  delivered integer := 0;
  next_due timestamptz;
BEGIN
  FOR item IN SELECT * FROM public.adviser_reminders
    WHERE status = 'active' AND action_kind = 'notification' AND due_at <= now()
    ORDER BY due_at LIMIT 100 FOR UPDATE SKIP LOCKED
  LOOP
    INSERT INTO public.notifications(account_id,user_id,type,conversation_id,title,body,target_url,dedup_key)
    VALUES(item.account_id,item.user_id,'system_notice',item.conversation_id,
      'RECORDATORIO PERSONAL',item.body,
      CASE WHEN item.conversation_id IS NULL THEN '/notifications' ELSE '/inbox?c=' || item.conversation_id::text END,
      'adviser-reminder:' || item.id::text || ':' || extract(epoch from item.due_at)::bigint::text);
    IF item.repeat_days IS NULL THEN
      UPDATE public.adviser_reminders SET status='done' WHERE id=item.id;
    ELSE
      next_due := item.due_at + make_interval(days => item.repeat_days);
      WHILE next_due <= now() LOOP
        next_due := next_due + make_interval(days => item.repeat_days);
      END LOOP;
      UPDATE public.adviser_reminders SET due_at=next_due WHERE id=item.id;
    END IF;
    delivered := delivered + 1;
  END LOOP;
  RETURN delivered;
END;
$$;
REVOKE ALL ON FUNCTION public.publish_due_adviser_reminders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_due_adviser_reminders() TO service_role;
