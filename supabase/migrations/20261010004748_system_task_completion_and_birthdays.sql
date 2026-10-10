ALTER TABLE public.notifications ADD COLUMN requires_action boolean NOT NULL DEFAULT false,
  ADD COLUMN completed_at timestamptz, ADD COLUMN completed_by uuid REFERENCES auth.users(id);
CREATE FUNCTION crm_private.classify_system_task() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  NEW.requires_action=NEW.type='system_notice' AND (NEW.dedup_key LIKE 'start:%' OR NEW.dedup_key LIKE 'calendar:%' OR NEW.dedup_key LIKE 'payment-followup:%');
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION crm_private.classify_system_task() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER classify_system_task BEFORE INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION crm_private.classify_system_task();
UPDATE public.notifications SET requires_action=true WHERE type='system_notice' AND (dedup_key LIKE 'start:%' OR dedup_key LIKE 'calendar:%' OR dedup_key LIKE 'payment-followup:%');

CREATE TABLE public.notification_task_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  notification_id uuid NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  task_key text NOT NULL, actor_id uuid NOT NULL REFERENCES auth.users(id), completed boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.notification_task_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_task_events FROM anon,authenticated;
GRANT SELECT ON public.notification_task_events TO authenticated;
CREATE POLICY task_events_read ON public.notification_task_events FOR SELECT TO authenticated USING (
  EXISTS(SELECT 1 FROM public.profiles p WHERE p.account_id=notification_task_events.account_id AND p.user_id=auth.uid() AND (p.account_role IN ('owner','admin') OR p.user_id=notification_task_events.actor_id))
);
CREATE INDEX task_events_account_time ON public.notification_task_events(account_id,created_at DESC);
CREATE FUNCTION public.complete_system_task(p_notification uuid,p_completed boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n record; actor record; task_key text; completed_time timestamptz;
BEGIN
  IF auth.uid() IS NULL OR p_completed IS NULL THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
  SELECT * INTO actor FROM public.profiles WHERE user_id=auth.uid();
  SELECT * INTO n FROM public.notifications WHERE id=p_notification AND account_id=actor.account_id AND requires_action=true AND (user_id=auth.uid() OR actor.account_role IN ('owner','admin'));
  IF NOT FOUND THEN RAISE EXCEPTION 'Tarea no disponible' USING ERRCODE='42501'; END IF;
  task_key=coalesce(n.dedup_key,n.id::text);
  PERFORM pg_advisory_xact_lock(hashtextextended(n.account_id::text||task_key,0));
  SELECT * INTO n FROM public.notifications WHERE id=p_notification FOR UPDATE;
  IF (n.completed_at IS NOT NULL)=p_completed THEN RETURN jsonb_build_object('completed_at',n.completed_at,'completed_by',n.completed_by); END IF;
  completed_time=CASE WHEN p_completed THEN now() ELSE NULL END;
  UPDATE public.notifications SET completed_at=completed_time,completed_by=CASE WHEN p_completed THEN auth.uid() ELSE NULL END
    WHERE account_id=n.account_id AND requires_action AND coalesce(dedup_key,id::text)=task_key;
  INSERT INTO public.notification_task_events(account_id,notification_id,task_key,actor_id,completed) VALUES(n.account_id,n.id,task_key,auth.uid(),p_completed);
  RETURN jsonb_build_object('completed_at',completed_time,'completed_by',CASE WHEN p_completed THEN auth.uid() ELSE NULL END);
END $$;
REVOKE ALL ON FUNCTION public.complete_system_task(uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.complete_system_task(uuid,boolean) TO authenticated;

CREATE FUNCTION public.publish_birthday_notices() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE today date=(now() AT TIME ZONE 'America/Lima')::date; birthday record; recipients integer; total integer=0;
BEGIN
  FOR birthday IN SELECT p.*,coalesce(nullif(btrim(nickname),''),full_name,'MIEMBRO DEL EQUIPO') AS display_name FROM public.profiles p
    WHERE birth_date IS NOT NULL AND account_role IN ('owner','admin','agent')
      AND to_char(birth_date,'MM-DD') IN (to_char(today,'MM-DD'),to_char(today+7,'MM-DD')) LOOP
    IF to_char(birthday.birth_date,'MM-DD')=to_char(today,'MM-DD') THEN
      INSERT INTO public.notifications(account_id,user_id,type,title,body,dedup_key)
        SELECT birthday.account_id,p.user_id,'system_notice','CUMPLEANOS DEL EQUIPO',
          'HOY ES EL CUMPLEANOS DE '||upper(birthday.display_name)||'.','birthday:day:'||birthday.user_id::text||':'||today::text
        FROM public.profiles p WHERE p.account_id=birthday.account_id AND p.user_id<>birthday.user_id AND p.account_role IN ('owner','admin','agent') ON CONFLICT DO NOTHING;
    ELSE
      INSERT INTO public.notifications(account_id,user_id,type,title,body,dedup_key)
        SELECT birthday.account_id,p.user_id,'system_notice','CUMPLEANOS EN UNA SEMANA',
          upper(birthday.display_name)||' CUMPLE ANOS EL '||to_char(today+7,'DD/MM/YYYY')||'. PREPARAR EL AVISO AL EQUIPO.','birthday:week:'||birthday.user_id::text||':'||(today+7)::text
        FROM public.profiles p WHERE p.account_id=birthday.account_id AND p.user_id<>birthday.user_id
          AND (p.account_role IN ('owner','admin') OR upper(coalesce(p.cargo,'')) LIKE '%COORDIN%') ON CONFLICT DO NOTHING;
    END IF;
    GET DIAGNOSTICS recipients=ROW_COUNT; total=total+recipients;
  END LOOP;
  RETURN total;
END $$;
REVOKE ALL ON FUNCTION public.publish_birthday_notices() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.publish_birthday_notices() TO service_role;
