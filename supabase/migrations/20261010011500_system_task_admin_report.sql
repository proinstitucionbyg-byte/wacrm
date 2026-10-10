CREATE FUNCTION public.system_task_admin_report(p_from timestamptz,p_until timestamptz)
RETURNS TABLE(id uuid,actor_id uuid,completed boolean,created_at timestamptz,title text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE account uuid;
BEGIN
  SELECT p.account_id INTO account FROM public.profiles p WHERE p.user_id=auth.uid() AND p.account_role IN ('owner','admin');
  IF account IS NULL THEN RAISE EXCEPTION 'Solo administracion' USING ERRCODE='42501'; END IF;
  IF p_from IS NULL OR p_until IS NULL OR p_from>=p_until OR p_until-p_from>interval '93 days' THEN RAISE EXCEPTION 'Periodo no valido'; END IF;
  RETURN QUERY SELECT e.id,e.actor_id,e.completed,e.created_at,n.title FROM public.notification_task_events e JOIN public.notifications n ON n.id=e.notification_id
    WHERE e.account_id=account AND e.created_at>=p_from AND e.created_at<p_until ORDER BY e.created_at DESC LIMIT 100;
END $$;
REVOKE ALL ON FUNCTION public.system_task_admin_report(timestamptz,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.system_task_admin_report(timestamptz,timestamptz) TO authenticated;
