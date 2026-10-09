ALTER TABLE public.team_threads ADD COLUMN archived_at timestamptz;
ALTER TABLE public.team_thread_members ADD COLUMN archived_at timestamptz;
CREATE OR REPLACE FUNCTION crm_private.team_access(target_thread uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS(SELECT 1 FROM public.team_threads t JOIN public.profiles p ON p.account_id=t.account_id AND p.user_id=auth.uid()
    WHERE t.id=target_thread AND (p.account_role IN ('owner','admin') OR EXISTS(SELECT 1 FROM public.team_thread_members m WHERE m.thread_id=t.id AND m.user_id=p.user_id))
    AND p.account_role IN ('owner','admin','agent'))
$$;
DROP POLICY team_messages_send ON public.team_messages;
CREATE POLICY team_messages_send ON public.team_messages FOR INSERT TO authenticated WITH CHECK(
  sender_id=auth.uid() AND crm_private.team_access(thread_id)
  AND EXISTS(SELECT 1 FROM public.team_thread_members m JOIN public.team_threads t ON t.id=m.thread_id
    WHERE m.thread_id=team_messages.thread_id AND m.user_id=auth.uid() AND t.archived_at IS NULL));

CREATE FUNCTION public.archive_team_thread(p_thread uuid,p_global boolean,p_restore boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor public.profiles; thread public.team_threads;
BEGIN
  SELECT * INTO actor FROM public.profiles WHERE user_id=auth.uid();
  SELECT * INTO thread FROM public.team_threads WHERE id=p_thread AND account_id=actor.account_id FOR UPDATE;
  IF NOT FOUND OR NOT crm_private.team_access(p_thread) THEN RAISE EXCEPTION 'Sin acceso' USING ERRCODE='42501'; END IF;
  IF p_global THEN
    IF actor.account_role NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Solo administracion' USING ERRCODE='42501'; END IF;
    UPDATE public.team_threads SET archived_at=CASE WHEN p_restore THEN NULL ELSE now() END WHERE id=p_thread;
  ELSE
    UPDATE public.team_thread_members SET archived_at=CASE WHEN p_restore THEN NULL ELSE now() END WHERE thread_id=p_thread AND user_id=auth.uid();
    IF NOT FOUND THEN RAISE EXCEPTION 'No eres participante' USING ERRCODE='42501'; END IF;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.archive_team_thread(uuid,boolean,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.archive_team_thread(uuid,boolean,boolean) TO authenticated;
CREATE FUNCTION public.delete_team_thread(p_thread uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE user_id=auth.uid() AND account_role='owner') THEN RAISE EXCEPTION 'Solo CEO' USING ERRCODE='42501'; END IF;
  DELETE FROM public.team_threads WHERE id=p_thread AND public.is_account_member(account_id,'owner');
END $$;
REVOKE ALL ON FUNCTION public.delete_team_thread(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.delete_team_thread(uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
