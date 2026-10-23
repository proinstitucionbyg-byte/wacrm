-- A manual "disable both" pause must stop every scheduled step, including
-- enrollment welcome sequences, and retain its exact next position.
ALTER TABLE public.automation_pending_executions
  DROP CONSTRAINT IF EXISTS automation_pending_executions_status_check;

ALTER TABLE public.automation_pending_executions
  ADD CONSTRAINT automation_pending_executions_status_check
  CHECK (status IN ('pending', 'running', 'paused', 'done', 'failed', 'cancelled'));

CREATE INDEX IF NOT EXISTS idx_automation_pending_paused_conversation
  ON public.automation_pending_executions(account_id, (context->>'conversation_id'))
  WHERE status = 'paused';

CREATE OR REPLACE FUNCTION public.set_conversation_automatic_pause(
  p_conversation uuid,
  p_paused boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account uuid;
  v_member_account uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT account_id INTO v_account
  FROM public.conversations
  WHERE id = p_conversation
  FOR UPDATE;
  IF v_account IS NULL THEN RETURN false; END IF;

  SELECT account_id INTO v_member_account
  FROM public.profiles WHERE user_id = auth.uid();
  IF v_member_account IS DISTINCT FROM v_account
     OR NOT public.has_member_permission(auth.uid(), 'inbox', 'send') THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE public.conversations
  SET ai_enabled = NOT p_paused,
      automation_enabled = NOT p_paused,
      ai_autoreply_disabled = p_paused,
      -- NULL means the timed five-minute reactivator must not undo this choice.
      ai_disabled_at = NULL,
      automation_disabled_at = NULL
  WHERE id = p_conversation AND account_id = v_account;

  IF p_paused THEN
    UPDATE public.automation_pending_executions
    SET status = 'paused'
    WHERE account_id = v_account
      AND context->>'conversation_id' = p_conversation::text
      AND status = 'pending';
  ELSE
    UPDATE public.automation_pending_executions
    -- Keep the original due time so an explicit resume preserves pacing.
    SET status = 'pending'
    WHERE account_id = v_account
      AND context->>'conversation_id' = p_conversation::text
      AND status = 'paused';
  END IF;

  RETURN true;
END;
$$;

ALTER FUNCTION public.set_conversation_automatic_pause(uuid, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_conversation_automatic_pause(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_conversation_automatic_pause(uuid, boolean) TO authenticated;
