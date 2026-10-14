-- Advisers keep access only to their own reminders. The account owner may
-- additionally read the team's reminders, but cannot edit or delete them.
ALTER POLICY adviser_reminders_read ON public.adviser_reminders
  USING (
    public.is_account_member(account_id)
    AND (user_id = auth.uid() OR public.is_account_member(account_id, 'owner'))
  );
