-- Calendar notices are completed by a final deliberate click after all
-- action checks are ticked. Unticking any check reopens a completed notice.
CREATE OR REPLACE FUNCTION public.complete_calendar_action(p_notification uuid,p_action text,p_completed boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor record; n record; checks jsonb; entry jsonb;
BEGIN
  SELECT * INTO actor FROM public.profiles WHERE user_id=auth.uid();
  IF actor.user_id IS NULL OR p_completed IS NULL OR p_action NOT IN ('groups','teacher','students','new_students','coordinator') THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501';
  END IF;
  SELECT * INTO n FROM public.notifications WHERE id=p_notification AND account_id=actor.account_id AND requires_action AND dedup_key LIKE 'calendar:%'
    AND (user_id=auth.uid() OR actor.account_role IN ('owner','admin'));
  IF NOT FOUND THEN RAISE EXCEPTION 'Aviso no disponible' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(n.account_id::text||n.dedup_key,0));
  SELECT action_checks INTO checks FROM public.notifications WHERE id=n.id FOR UPDATE;
  entry=jsonb_build_object('completed',p_completed,'at',clock_timestamp(),'by',auth.uid());
  checks=jsonb_set(checks,ARRAY[p_action],entry,true);
  UPDATE public.notifications SET action_checks=checks,
    completed_at=CASE WHEN p_completed THEN completed_at ELSE NULL END,
    completed_by=CASE WHEN p_completed THEN completed_by ELSE NULL END
    WHERE account_id=n.account_id AND dedup_key=n.dedup_key;
  RETURN checks;
END $$;

CREATE OR REPLACE FUNCTION public.complete_system_task(p_notification uuid,p_completed boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n record; actor record; task_key text; completed_time timestamptz; checks jsonb;
BEGIN
  IF auth.uid() IS NULL OR p_completed IS NULL THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
  SELECT * INTO actor FROM public.profiles WHERE user_id=auth.uid();
  SELECT * INTO n FROM public.notifications WHERE id=p_notification AND account_id=actor.account_id AND requires_action=true AND (user_id=auth.uid() OR actor.account_role IN ('owner','admin'));
  IF NOT FOUND THEN RAISE EXCEPTION 'Tarea no disponible' USING ERRCODE='42501'; END IF;
  task_key=coalesce(n.dedup_key,n.id::text);
  PERFORM pg_advisory_xact_lock(hashtextextended(n.account_id::text||task_key,0));
  SELECT * INTO n FROM public.notifications WHERE id=p_notification FOR UPDATE;
  IF p_completed AND n.dedup_key LIKE 'calendar:%' THEN
    checks=n.action_checks;
    IF NOT (
      coalesce((checks->'groups'->>'completed')::boolean,false)
      AND coalesce((checks->'teacher'->>'completed')::boolean,false)
      AND coalesce((checks->'students'->>'completed')::boolean,false)
      AND coalesce((checks->'new_students'->>'completed')::boolean,false)
      AND (position('COORDINADORA' in coalesce(n.body,''))=0 OR coalesce((checks->'coordinator'->>'completed')::boolean,false))
    ) THEN RAISE EXCEPTION 'Completa todos los avisos antes de marcar realizado'; END IF;
  END IF;
  IF (n.completed_at IS NOT NULL)=p_completed THEN RETURN jsonb_build_object('completed_at',n.completed_at,'completed_by',n.completed_by); END IF;
  completed_time=CASE WHEN p_completed THEN now() ELSE NULL END;
  UPDATE public.notifications SET completed_at=completed_time,completed_by=CASE WHEN p_completed THEN auth.uid() ELSE NULL END
    WHERE account_id=n.account_id AND requires_action AND coalesce(dedup_key,id::text)=task_key;
  INSERT INTO public.notification_task_events(account_id,notification_id,task_key,actor_id,completed) VALUES(n.account_id,n.id,task_key,auth.uid(),p_completed);
  RETURN jsonb_build_object('completed_at',completed_time,'completed_by',CASE WHEN p_completed THEN auth.uid() ELSE NULL END);
END $$;
