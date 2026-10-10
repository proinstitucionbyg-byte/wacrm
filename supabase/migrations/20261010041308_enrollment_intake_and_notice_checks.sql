ALTER TABLE public.enrollment_drafts ADD COLUMN intake_adviser text;
ALTER TABLE public.enrollment_sequence_runs ADD COLUMN backup_sent_at timestamptz;
CREATE FUNCTION crm_private.assign_registered_intake() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE recipient uuid; matches integer;
BEGIN
  IF NEW.status<>'registered' OR NEW.conversation_id IS NULL OR coalesce(btrim(NEW.intake_adviser),'')='' THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND OLD.status='registered' AND OLD.intake_adviser IS NOT DISTINCT FROM NEW.intake_adviser THEN RETURN NEW; END IF;
  SELECT count(*),(array_agg(p.user_id))[1] INTO matches,recipient FROM public.profiles p WHERE p.account_id=NEW.account_id
    AND upper(btrim(coalesce(nullif(p.nickname,''),p.full_name)))=upper(btrim(NEW.intake_adviser)) AND upper(btrim(p.area))='FIDELIZACION'
    AND public.has_member_permission(p.user_id,'inbox','view') AND public.has_member_permission(p.user_id,'inbox','send');
  IF matches=1 THEN
    UPDATE public.conversations SET assigned_agent_id=recipient,updated_at=now() WHERE id=NEW.conversation_id AND account_id=NEW.account_id;
  ELSE
    INSERT INTO public.notifications(account_id,user_id,type,title,body,target_url,dedup_key)
      SELECT NEW.account_id,p.user_id,'system_notice','CONFIGURAR ASESORA DE INGRESO',
      'LA MATRICULA ESTA REGISTRADA. NO SE ENCONTRO UNA CUENTA UNICA DE FIDELIZACION CON EL APODO '||NEW.intake_adviser||'. DOCUMENTOS Y BIENVENIDA AUTOMATICA CONTINUAN.',
      '/inbox?c='||NEW.conversation_id::text,'intake:'||NEW.id::text FROM public.profiles p WHERE p.account_id=NEW.account_id AND p.account_role IN ('owner','admin') ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION crm_private.assign_registered_intake() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER assign_registered_intake AFTER UPDATE OF status,intake_adviser ON public.enrollment_drafts FOR EACH ROW EXECUTE FUNCTION crm_private.assign_registered_intake();

ALTER TABLE public.notifications ADD COLUMN action_checks jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(action_checks)='object');
CREATE FUNCTION public.complete_calendar_action(p_notification uuid,p_action text,p_completed boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor record; n record; checks jsonb; task_key text; entry jsonb; finished boolean;
BEGIN
  SELECT * INTO actor FROM public.profiles WHERE user_id=auth.uid();
  IF actor.user_id IS NULL OR p_completed IS NULL OR p_action NOT IN ('groups','teacher','students','new_students') THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
  SELECT * INTO n FROM public.notifications WHERE id=p_notification AND account_id=actor.account_id AND requires_action AND dedup_key LIKE 'calendar:%'
    AND (user_id=auth.uid() OR actor.account_role IN ('owner','admin'));
  IF NOT FOUND THEN RAISE EXCEPTION 'Aviso no disponible' USING ERRCODE='42501'; END IF;
  task_key=n.dedup_key;
  PERFORM pg_advisory_xact_lock(hashtextextended(task_key||n.account_id::text,0));
  SELECT action_checks INTO checks FROM public.notifications WHERE id=n.id FOR UPDATE;
  entry=jsonb_build_object('completed',p_completed,'at',clock_timestamp(),'by',auth.uid());
  checks=jsonb_set(checks,ARRAY[p_action],entry,true);
  finished=coalesce((checks->'groups'->>'completed')::boolean,false) AND coalesce((checks->'teacher'->>'completed')::boolean,false)
    AND coalesce((checks->'students'->>'completed')::boolean,false) AND coalesce((checks->'new_students'->>'completed')::boolean,false);
  UPDATE public.notifications SET action_checks=checks,completed_at=CASE WHEN finished THEN clock_timestamp() END,completed_by=CASE WHEN finished THEN auth.uid() END
    WHERE account_id=n.account_id AND dedup_key=task_key;
  RETURN checks;
END $$;
REVOKE ALL ON FUNCTION public.complete_calendar_action(uuid,text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.complete_calendar_action(uuid,text,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.complete_enrollment_welcome(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r record; actor record;
BEGIN
  SELECT * INTO actor FROM public.profiles WHERE user_id=auth.uid();
  SELECT * INTO r FROM public.enrollment_sequence_runs WHERE id=p_id AND stage='final' AND account_id=actor.account_id FOR UPDATE;
  IF NOT FOUND OR NOT public.has_member_permission(auth.uid(),'inbox','send') OR crm_private.inbox_visible_from(r.conversation_id) IS NULL
    OR (actor.account_role NOT IN ('owner','admin') AND upper(btrim(coalesce(actor.area,'')))<>'FIDELIZACION') THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
  IF r.completed_at IS NOT NULL THEN RETURN jsonb_build_object('completed_at',r.completed_at); END IF;
  IF r.status<>'started' OR r.welcome_due_at IS NULL OR now()>=r.welcome_due_at THEN RAISE EXCEPTION 'El plazo de bienvenida no esta disponible'; END IF;
  UPDATE public.enrollment_sequence_runs SET completed_at=clock_timestamp(),completed_by=auth.uid() WHERE id=r.id;
  RETURN jsonb_build_object('completed_at',clock_timestamp());
END $$;
REVOKE ALL ON FUNCTION public.complete_enrollment_welcome(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.complete_enrollment_welcome(uuid) TO authenticated;
