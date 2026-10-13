-- A pin belongs to one adviser. Reading the linked message still follows
-- the existing inbox visibility policy (including restricted transfers).
CREATE TABLE public.message_pins (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, message_id)
);
CREATE INDEX message_pins_conversation_idx ON public.message_pins(user_id, conversation_id, created_at DESC);
ALTER TABLE public.message_pins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.message_pins FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.message_pins TO authenticated;
CREATE POLICY message_pins_read ON public.message_pins FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND public.is_account_member(account_id)
    AND EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = conversation_id AND c.account_id = message_pins.account_id)
    AND EXISTS (SELECT 1 FROM public.messages m WHERE m.id = message_pins.message_id AND m.conversation_id = message_pins.conversation_id));
CREATE POLICY message_pins_add ON public.message_pins FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.is_account_member(account_id)
    AND EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = conversation_id AND c.account_id = message_pins.account_id)
    AND EXISTS (SELECT 1 FROM public.messages m WHERE m.id = message_pins.message_id AND m.conversation_id = message_pins.conversation_id));
CREATE POLICY message_pins_remove ON public.message_pins FOR DELETE TO authenticated
  USING (user_id = auth.uid());

CREATE TABLE public.adviser_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 1000),
  due_at timestamptz NOT NULL,
  repeat_days integer CHECK (repeat_days BETWEEN 1 AND 365),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','done')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX adviser_reminders_due_idx ON public.adviser_reminders(due_at) WHERE status = 'active';
CREATE INDEX adviser_reminders_user_idx ON public.adviser_reminders(user_id, due_at);
ALTER TABLE public.adviser_reminders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.adviser_reminders FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.adviser_reminders TO authenticated;
CREATE POLICY adviser_reminders_read ON public.adviser_reminders FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND public.is_account_member(account_id));
CREATE POLICY adviser_reminders_add ON public.adviser_reminders FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.is_account_member(account_id)
    AND (conversation_id IS NULL OR EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = conversation_id AND c.account_id = adviser_reminders.account_id)));
CREATE POLICY adviser_reminders_edit ON public.adviser_reminders FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND public.is_account_member(account_id))
  WITH CHECK (user_id = auth.uid() AND public.is_account_member(account_id)
    AND (conversation_id IS NULL OR EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = conversation_id AND c.account_id = adviser_reminders.account_id)));
CREATE POLICY adviser_reminders_remove ON public.adviser_reminders FOR DELETE TO authenticated
  USING (user_id = auth.uid() AND public.is_account_member(account_id));

-- The existing 15-second server scheduler calls this as service_role. One
-- transaction locks each due row and creates exactly one notification.
CREATE OR REPLACE FUNCTION public.publish_due_adviser_reminders()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  item public.adviser_reminders%ROWTYPE;
  delivered integer := 0;
  next_due timestamptz;
BEGIN
  FOR item IN SELECT * FROM public.adviser_reminders
    WHERE status = 'active' AND due_at <= now()
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
