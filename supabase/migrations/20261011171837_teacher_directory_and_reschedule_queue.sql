CREATE TABLE public.academic_teacher_directories (
  account_id uuid PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  teachers jsonb NOT NULL CHECK(jsonb_typeof(teachers)='array'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.teacher_reschedule_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  message_id text NOT NULL,
  course text,
  teacher_name text,
  class_date date,
  status text NOT NULL CHECK(status IN ('queued','manual','applied')),
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz,
  UNIQUE(account_id,conversation_id,message_id),
  CHECK(status='manual' OR (course IS NOT NULL AND teacher_name IS NOT NULL AND class_date IS NOT NULL))
);
ALTER TABLE public.academic_teacher_directories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teacher_reschedule_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.academic_teacher_directories,public.teacher_reschedule_requests FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.academic_teacher_directories,public.teacher_reschedule_requests TO service_role;
GRANT SELECT ON public.academic_teacher_directories,public.teacher_reschedule_requests TO authenticated;
CREATE POLICY teachers_admin_read ON public.academic_teacher_directories FOR SELECT TO authenticated USING (
  EXISTS(SELECT 1 FROM public.profiles p WHERE p.user_id=auth.uid() AND p.account_id=academic_teacher_directories.account_id AND p.account_role IN ('owner','admin'))
);
CREATE POLICY teacher_requests_admin_read ON public.teacher_reschedule_requests FOR SELECT TO authenticated USING (
  EXISTS(SELECT 1 FROM public.profiles p WHERE p.user_id=auth.uid() AND p.account_id=teacher_reschedule_requests.account_id AND p.account_role IN ('owner','admin'))
);
CREATE INDEX teacher_reschedule_pending ON public.teacher_reschedule_requests(account_id,created_at) WHERE status='queued';
CREATE FUNCTION public.record_teacher_reschedule(p_account uuid,p_conversation uuid,p_message text,p_course text,p_day date,p_teacher text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE request_id uuid; evidence record; verified boolean;
BEGIN
  SELECT m.content_text,c.phone,c.channel INTO evidence FROM public.messages m
    JOIN public.conversations v ON v.id=m.conversation_id JOIN public.contacts c ON c.id=v.contact_id AND c.account_id=v.account_id
    WHERE v.account_id=p_account AND v.id=p_conversation AND m.message_id=p_message AND m.sender_type='customer' LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Mensaje no disponible'; END IF;
  IF p_day IS NOT NULL THEN
    SELECT EXISTS(SELECT 1 FROM public.academic_teacher_directories d CROSS JOIN LATERAL jsonb_array_elements(d.teachers) t
      WHERE d.account_id=p_account AND d.updated_at>now()-interval '30 minutes' AND evidence.channel='whatsapp'
      AND t->>'course'=p_course AND t->>'name'=p_teacher AND t->'phones' ? regexp_replace(evidence.phone,'[^0-9]','','g')) INTO verified;
    IF NOT verified OR p_day<>(now() AT TIME ZONE 'America/Lima')::date OR NOT EXISTS (
      SELECT 1 FROM public.academic_calendar_snapshots s CROSS JOIN LATERAL jsonb_array_elements(s.modules) m
      WHERE s.account_id=p_account AND s.updated_at>now()-interval '30 minutes' AND m->>'course'=p_course AND m->'class_dates' ? p_day::text
      AND now()>=((p_day::text||' '||(m->>'hour'))::timestamp AT TIME ZONE 'America/Lima')-interval '30 minutes'
      AND now()<((p_day::text||' '||(m->>'hour'))::timestamp AT TIME ZONE 'America/Lima')+interval '2 hours'
    ) THEN RAISE EXCEPTION 'Docente, clase u horario no confirmado'; END IF;
  END IF;
  INSERT INTO public.teacher_reschedule_requests(account_id,conversation_id,message_id,course,teacher_name,class_date,status)
    VALUES(p_account,p_conversation,p_message,p_course,p_teacher,p_day,CASE WHEN p_day IS NULL THEN 'manual' ELSE 'queued' END)
    ON CONFLICT(account_id,conversation_id,message_id) DO NOTHING RETURNING id INTO request_id;
  IF request_id IS NULL THEN RETURN jsonb_build_object('created',false); END IF;
  INSERT INTO public.notifications(account_id,user_id,type,title,body,target_url,dedup_key)
    SELECT p_account,p.user_id,'system_notice',CASE WHEN p_day IS NULL THEN 'CONFIRMAR AVISO DE DOCENTE' ELSE 'REPROGRAMACION URGENTE EN PROCESO' END,
      coalesce(p_teacher,'IDENTIDAD POR CONFIRMAR')||' — '||coalesce(p_course,'CURSO POR CONFIRMAR')||E'\n'||left(coalesce(evidence.content_text,''),1000)||
      CASE WHEN p_day IS NULL THEN E'\nCONFIRMAR IDENTIDAD, FECHA Y JUSTIFICACION. NO SE HAN CAMBIADO FECHAS.' ELSE E'\nACTUALIZACION AUTOMATICA EN COLA. ESPERAR EL AVISO CON LA NUEVA FECHA CONFIRMADA.' END,
      '/inbox?c='||p_conversation::text,'teacher-request:'||request_id::text
    FROM public.profiles p WHERE p.account_id=p_account AND (upper(btrim(p.area))='FIDELIZACION' OR p.account_role IN ('owner','admin')) ON CONFLICT DO NOTHING;
  RETURN jsonb_build_object('created',true,'id',request_id);
END $$;
REVOKE ALL ON FUNCTION public.record_teacher_reschedule(uuid,uuid,text,text,date,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_teacher_reschedule(uuid,uuid,text,text,date,text) TO service_role;

ALTER TABLE public.notifications ADD COLUMN expires_at timestamptz;
CREATE OR REPLACE FUNCTION public.sync_academic_calendar(p_account uuid,p_modules jsonb,p_source text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE previous jsonb; changed text; notice_key text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('calendar:'||p_account::text,0));
  SELECT modules INTO previous FROM public.academic_calendar_snapshots WHERE account_id=p_account;
  IF previous IS NOT NULL AND previous<>p_modules THEN
    SELECT string_agg((r->>'course')||': '||(r->>'module')||' — INICIO ACTUALIZADO '||(r->>'start_date'),E'\n') INTO changed FROM jsonb_array_elements(p_modules) r WHERE NOT previous @> jsonb_build_array(r);
    notice_key='calendar:'||md5(previous::text||p_modules::text);
    INSERT INTO public.notifications(account_id,user_id,type,title,body,target_url,dedup_key,expires_at)
      SELECT p_account,p.user_id,'system_notice','CUADRO DE INICIOS ACTUALIZADO — AVISAR REPROGRAMACION',
        coalesce(changed,'CAMBIO DE PROGRAMACION')||E'\nLA NUEVA FECHA YA ESTA ACTUALIZADA EN EL CUADRO. AVISAR A LOS GRUPOS, A LOS ESTUDIANTES AFECTADOS, A LOS NUEVOS INGRESOS CUYO INICIO SE APLAZA, AL DOCENTE Y A LA COORDINADORA DE FIDELIZACION. INDICAR EL MOTIVO CONFIRMADO Y LA NUEVA FECHA, SIN INVENTAR MOTIVOS. LOS PDF YA ENTREGADOS SE CONSERVAN. AVISO VISIBLE DURANTE TRES DIAS; HISTORIAL CONSERVADO.',
        p_source,notice_key,now()+interval '3 days'
      FROM public.profiles p WHERE p.account_id=p_account AND (upper(btrim(p.area))='FIDELIZACION' OR p.account_role IN ('owner','admin')) ON CONFLICT DO NOTHING;
  END IF;
  INSERT INTO public.academic_calendar_snapshots(account_id,modules,source_url,updated_at) VALUES(p_account,p_modules,p_source,now())
    ON CONFLICT(account_id) DO UPDATE SET modules=EXCLUDED.modules,source_url=EXCLUDED.source_url,updated_at=EXCLUDED.updated_at;
END $$;
CREATE OR REPLACE FUNCTION public.complete_calendar_action(p_notification uuid,p_action text,p_completed boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor record; n record; checks jsonb; entry jsonb; finished boolean;
BEGIN
  SELECT * INTO actor FROM public.profiles WHERE user_id=auth.uid();
  IF actor.user_id IS NULL OR p_completed IS NULL OR p_action NOT IN ('groups','teacher','students','new_students','coordinator') THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
  SELECT * INTO n FROM public.notifications WHERE id=p_notification AND account_id=actor.account_id AND requires_action AND dedup_key LIKE 'calendar:%'
    AND (user_id=auth.uid() OR actor.account_role IN ('owner','admin'));
  IF NOT FOUND THEN RAISE EXCEPTION 'Aviso no disponible' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(n.dedup_key||n.account_id::text,0));
  SELECT action_checks INTO checks FROM public.notifications WHERE id=n.id FOR UPDATE;
  entry=jsonb_build_object('completed',p_completed,'at',clock_timestamp(),'by',auth.uid());
  checks=jsonb_set(checks,ARRAY[p_action],entry,true);
  finished=coalesce((checks->'groups'->>'completed')::boolean,false) AND coalesce((checks->'teacher'->>'completed')::boolean,false)
    AND coalesce((checks->'students'->>'completed')::boolean,false) AND coalesce((checks->'new_students'->>'completed')::boolean,false)
    AND (position('COORDINADORA' in coalesce(n.body,''))=0 OR coalesce((checks->'coordinator'->>'completed')::boolean,false));
  UPDATE public.notifications SET action_checks=checks,completed_at=CASE WHEN finished THEN clock_timestamp() END,completed_by=CASE WHEN finished THEN auth.uid() END
    WHERE account_id=n.account_id AND dedup_key=n.dedup_key;
  RETURN checks;
END $$;
