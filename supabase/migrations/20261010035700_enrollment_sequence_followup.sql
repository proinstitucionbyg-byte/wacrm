CREATE TABLE public.enrollment_sequence_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  source_id uuid NOT NULL, stage text NOT NULL CHECK(stage IN ('receipt','final')),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  automation_id uuid NOT NULL REFERENCES public.automations(id),
  status text NOT NULL DEFAULT 'running' CHECK(status IN ('running','started','review')),
  started_at timestamptz NOT NULL DEFAULT now(), welcome_due_at timestamptz,
  completed_at timestamptz, completed_by uuid REFERENCES auth.users(id), error text,
  UNIQUE(account_id,source_id,stage)
);
ALTER TABLE public.enrollment_sequence_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.enrollment_sequence_runs FROM anon,authenticated;
GRANT SELECT ON public.enrollment_sequence_runs TO authenticated;
GRANT ALL ON public.enrollment_sequence_runs TO service_role;
CREATE POLICY enrollment_sequence_read ON public.enrollment_sequence_runs FOR SELECT TO authenticated USING (
  crm_private.inbox_visible_from(conversation_id) IS NOT NULL
  AND EXISTS(SELECT 1 FROM public.profiles p WHERE p.user_id=auth.uid() AND p.account_id=enrollment_sequence_runs.account_id)
);
CREATE FUNCTION public.complete_enrollment_welcome(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r record; actor record;
BEGIN
  SELECT * INTO actor FROM public.profiles WHERE user_id=auth.uid();
  SELECT * INTO r FROM public.enrollment_sequence_runs WHERE id=p_id AND stage='final' AND account_id=actor.account_id FOR UPDATE;
  IF NOT FOUND OR NOT public.has_member_permission(auth.uid(),'inbox','send') OR crm_private.inbox_visible_from(r.conversation_id) IS NULL
    OR (actor.account_role NOT IN ('owner','admin') AND upper(btrim(coalesce(actor.area,'')))<>'FIDELIZACION') THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
  IF r.completed_at IS NOT NULL THEN RETURN jsonb_build_object('completed_at',r.completed_at); END IF;
  IF now()>=r.welcome_due_at THEN RAISE EXCEPTION 'El plazo de bienvenida ya vencio'; END IF;
  UPDATE public.enrollment_sequence_runs SET completed_at=clock_timestamp(),completed_by=auth.uid() WHERE id=r.id;
  RETURN jsonb_build_object('completed_at',clock_timestamp());
END $$;
REVOKE ALL ON FUNCTION public.complete_enrollment_welcome(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.complete_enrollment_welcome(uuid) TO authenticated;
