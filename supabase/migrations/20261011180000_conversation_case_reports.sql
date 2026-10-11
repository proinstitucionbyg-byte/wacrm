-- Staff record actual reasons and solutions; message volume is not a complaint.
CREATE TABLE public.conversation_cases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
 reason text NOT NULL CHECK(char_length(btrim(reason)) BETWEEN 1 AND 200),
 solution text NOT NULL DEFAULT '' CHECK(char_length(solution)<=2000),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
 created_by uuid NOT NULL REFERENCES auth.users(id),
 updated_by uuid NOT NULL REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 version integer NOT NULL DEFAULT 1,
 CHECK(status<>'resolved' OR char_length(btrim(solution))>0)
);
CREATE INDEX conversation_cases_thread ON public.conversation_cases(conversation_id,created_at);
ALTER TABLE public.conversation_cases ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.conversation_cases TO authenticated;
CREATE POLICY conversation_cases_visible ON public.conversation_cases FOR SELECT TO authenticated
 USING(created_at>=crm_private.inbox_visible_from(conversation_id));

CREATE FUNCTION public.save_conversation_case(p_conversation uuid,p_reason text,p_solution text,p_status text,p_id uuid DEFAULT NULL,p_version integer DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result uuid; boundary timestamptz;
BEGIN
 boundary=crm_private.inbox_visible_from(p_conversation);
 IF auth.uid() IS NULL OR boundary IS NULL OR NOT public.has_member_permission(auth.uid(),'inbox','send')
 OR NOT EXISTS(SELECT 1 FROM public.conversations c JOIN public.profiles p ON p.account_id=c.account_id WHERE c.id=p_conversation AND p.user_id=auth.uid())
 THEN RAISE EXCEPTION 'No tienes permiso para registrar casos de este chat' USING ERRCODE='42501'; END IF;
 IF p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 1 AND 200 OR p_solution IS NULL OR char_length(p_solution)>2000 OR p_status IS NULL OR p_status NOT IN ('open','resolved') OR (p_status='resolved' AND btrim(p_solution)='')
 THEN RAISE EXCEPTION 'Indica motivo y, si está resuelto, la solución aplicada' USING ERRCODE='22023'; END IF;
 IF p_id IS NULL THEN
  INSERT INTO public.conversation_cases(conversation_id,reason,solution,status,created_by,updated_by)
   VALUES(p_conversation,btrim(p_reason),btrim(p_solution),p_status,auth.uid(),auth.uid()) RETURNING id INTO result;
 ELSE
  UPDATE public.conversation_cases SET reason=btrim(p_reason),solution=btrim(p_solution),status=p_status,updated_by=auth.uid(),updated_at=now(),version=version+1
   WHERE id=p_id AND conversation_id=p_conversation AND created_at>=boundary AND version=p_version RETURNING id INTO result;
  IF result IS NULL THEN RAISE EXCEPTION 'El caso cambió o ya no está disponible; actualiza el chat' USING ERRCODE='40001'; END IF;
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.save_conversation_case(uuid,text,text,text,uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_conversation_case(uuid,text,text,text,uuid,integer) TO authenticated;

CREATE TABLE public.case_reports (
 account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
 period_start timestamptz NOT NULL,period_end timestamptz NOT NULL,
 period_kind text NOT NULL CHECK(period_kind IN ('week','month')),
 cases jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(account_id,period_kind,period_start)
);
ALTER TABLE public.case_reports ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.case_reports TO authenticated;
CREATE POLICY case_reports_ceo ON public.case_reports FOR SELECT TO authenticated
 USING(EXISTS(SELECT 1 FROM public.profiles p WHERE p.user_id=auth.uid() AND p.account_id=case_reports.account_id AND p.account_role='owner'));

CREATE FUNCTION public.publish_case_reports(p_force boolean DEFAULT false) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE local_now timestamp=now() AT TIME ZONE 'America/Lima'; finish timestamptz; start_at timestamptz; end_at timestamptz; kind text; owner_row record; items jsonb; total integer=0;
BEGIN
 IF NOT p_force AND (extract(isodow FROM local_now)<>6 OR extract(hour FROM local_now)<7) THEN RETURN 0; END IF;
 finish=(date_trunc('week',local_now)+interval '5 days 7 hours') AT TIME ZONE 'America/Lima';
 IF finish>now() THEN finish=finish-interval '7 days'; END IF;
 FOR owner_row IN SELECT account_id,user_id FROM public.profiles WHERE account_role='owner' LOOP
  IF NOT p_force AND EXISTS(SELECT 1 FROM public.notifications WHERE user_id=owner_row.user_id AND account_id=owner_row.account_id AND dedup_key='cases:'||local_now::date::text) THEN CONTINUE; END IF;
  FOREACH kind IN ARRAY ARRAY['week','month'] LOOP
   end_at=CASE WHEN kind='month' AND p_force THEN now() ELSE finish END;
   start_at=CASE WHEN kind='week' THEN finish-interval '7 days' ELSE date_trunc('month',end_at AT TIME ZONE 'America/Lima') AT TIME ZONE 'America/Lima' END;
   SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.created_at),'[]'::jsonb) INTO items FROM (
    SELECT k.id,k.conversation_id,k.reason,k.solution,k.status,k.created_at,k.updated_at,
     coalesce(nullif(btrim(p.nickname),''),p.full_name,'SIN APODO') AS adviser,coalesce(p.area,'SIN AREA') AS area
    FROM public.conversation_cases k JOIN public.conversations c ON c.id=k.conversation_id LEFT JOIN public.profiles p ON p.user_id=k.updated_by AND p.account_id=c.account_id
    WHERE c.account_id=owner_row.account_id AND k.created_at>=start_at AND k.created_at<end_at
   ) x;
   INSERT INTO public.case_reports(account_id,period_start,period_end,period_kind,cases) VALUES(owner_row.account_id,start_at,end_at,kind,items)
    ON CONFLICT(account_id,period_kind,period_start) DO UPDATE SET period_end=excluded.period_end,cases=excluded.cases,created_at=now();
  END LOOP;
  IF NOT p_force THEN
   INSERT INTO public.notifications(account_id,user_id,type,title,body,target_url,dedup_key)
    VALUES(owner_row.account_id,owner_row.user_id,'system_notice','REPORTE SEMANAL · QUEJAS Y SOLUCIONES','Motivos y soluciones registrados por el equipo. Incluye acumulado mensual. Los casos sin clasificar no se inventan.','/reports','cases:'||local_now::date::text) ON CONFLICT DO NOTHING;
  END IF;
  total=total+1;
 END LOOP;RETURN total;
END $$;
REVOKE ALL ON FUNCTION public.publish_case_reports(boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.publish_case_reports(boolean) TO service_role;

DO $$ DECLARE definition text; BEGIN
 definition=pg_get_functiondef('public.publish_operational_notices()'::regprocedure);
 definition=replace(definition,'SOLUCIONES Y MOTIVOS DE QUEJAS: SIN CLASIFICACION ESTRUCTURADA; NO SE INFIEREN DEL NUMERO DE MENSAJES.','SOLUCIONES Y MOTIVOS DE QUEJAS: VER EL REPORTE DE CASOS EN ESTADISTICAS; SOLO SE INCLUYEN CASOS REGISTRADOS POR EL EQUIPO.');
 EXECUTE definition;
END $$;
