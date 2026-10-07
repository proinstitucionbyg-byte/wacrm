-- Align the schema with fields and states already used by the runtime.
-- Safe to apply when some columns were added manually in an existing install.

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS followup_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_human_message_at timestamptz,
  ADD COLUMN IF NOT EXISTS ai_handed_off_at timestamptz,
  ADD COLUMN IF NOT EXISTS ai_disabled_at timestamptz,
  ADD COLUMN IF NOT EXISTS automation_disabled_at timestamptz;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS area text;

-- The automation runner cancels pending waits when a human or the AI takes
-- over. Keep the database constraint in sync with those runtime writes.
ALTER TABLE public.automation_pending_executions
  DROP CONSTRAINT IF EXISTS automation_pending_executions_status_check;

ALTER TABLE public.automation_pending_executions
  ADD CONSTRAINT automation_pending_executions_status_check
  CHECK (status IN ('pending', 'running', 'done', 'failed', 'cancelled'));

-- The members settings screen calls this RPC to show the effective permission
-- for each definition. Restrict it to admins of the same account as the target.
CREATE OR REPLACE FUNCTION public.get_member_permissions(p_user_id uuid)
RETURNS TABLE (
  permission_id uuid,
  module text,
  action text,
  label text,
  description text,
  allowed boolean,
  source text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_account_id uuid;
  v_caller_role public.account_role_enum;
  v_target_account_id uuid;
  v_target_role public.account_role_enum;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT p.account_id, p.account_role
    INTO v_caller_account_id, v_caller_role
    FROM public.profiles AS p
   WHERE p.user_id = auth.uid();

  IF v_caller_account_id IS NULL
     OR v_caller_role IS NULL
     OR v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'This action requires the admin role or higher'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.account_id, p.account_role
    INTO v_target_account_id, v_target_role
    FROM public.profiles AS p
   WHERE p.user_id = p_user_id;

  IF v_target_account_id IS NULL THEN
    RAISE EXCEPTION 'Target user not found' USING ERRCODE = '22023';
  END IF;

  IF v_target_account_id <> v_caller_account_id THEN
    RAISE EXCEPTION 'Target user is not a member of your account'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    d.id,
    d.module,
    d.action,
    d.label,
    d.description,
    CASE
      WHEN v_target_role IN ('owner', 'admin') THEN true
      WHEN o.allowed IS NOT NULL THEN o.allowed
      ELSE COALESCE(r.allowed, false)
    END,
    CASE
      WHEN v_target_role IN ('owner', 'admin') THEN v_target_role::text
      WHEN o.allowed IS NOT NULL THEN 'override'
      ELSE 'role'
    END
  FROM public.permission_definitions AS d
  LEFT JOIN public.role_permissions AS r
    ON r.permission_id = d.id
   AND r.role = v_target_role
  LEFT JOIN public.member_permission_overrides AS o
    ON o.permission_id = d.id
   AND o.user_id = p_user_id
  ORDER BY d.module, d.action;
END;
$$;

ALTER FUNCTION public.get_member_permissions(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_member_permissions(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_member_permissions(uuid) TO authenticated;
