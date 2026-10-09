CREATE TABLE public.account_sales_routing (
  account_id uuid PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.member_sales_routing (
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  percentage integer NOT NULL DEFAULT 0 CHECK(percentage BETWEEN 0 AND 100),
  current_weight integer NOT NULL DEFAULT 0,
  PRIMARY KEY(account_id,user_id)
);
ALTER TABLE public.account_sales_routing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_sales_routing ENABLE ROW LEVEL SECURITY;
CREATE POLICY sales_config_read ON public.account_sales_routing FOR SELECT TO authenticated USING(public.is_account_member(account_id,'admin'));
CREATE POLICY sales_members_read ON public.member_sales_routing FOR SELECT TO authenticated USING(public.is_account_member(account_id,'admin'));
REVOKE ALL ON public.account_sales_routing,public.member_sales_routing FROM anon,authenticated;
GRANT SELECT ON public.account_sales_routing,public.member_sales_routing TO authenticated;
GRANT ALL ON public.account_sales_routing,public.member_sales_routing TO service_role;

CREATE OR REPLACE FUNCTION public.configure_sales_routing(p_members jsonb,p_enabled boolean,p_version integer)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE account_uuid uuid; current_config public.account_sales_routing; member record; total integer;
BEGIN
  SELECT account_id INTO account_uuid FROM public.profiles WHERE user_id=auth.uid() AND account_role IN ('owner','admin');
  IF account_uuid IS NULL THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE='42501'; END IF;
  IF p_members IS NULL OR jsonb_typeof(p_members)<>'array' OR p_enabled IS NULL OR p_version IS NULL THEN RAISE EXCEPTION 'Invalid configuration'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(account_uuid::text || ':sales',0));
  INSERT INTO public.account_sales_routing(account_id) VALUES(account_uuid) ON CONFLICT DO NOTHING;
  SELECT * INTO current_config FROM public.account_sales_routing WHERE account_id=account_uuid FOR UPDATE;
  IF current_config.version<>p_version THEN RAISE EXCEPTION 'Configuration changed' USING ERRCODE='40001'; END IF;
  IF jsonb_array_length(p_members)<>(SELECT count(*) FROM public.profiles WHERE account_id=account_uuid)
    OR (SELECT count(DISTINCT value->>'user_id') FROM jsonb_array_elements(p_members))<>jsonb_array_length(p_members) THEN
    RAISE EXCEPTION 'Team changed' USING ERRCODE='40001';
  END IF;
  total=0;
  FOR member IN SELECT * FROM jsonb_to_recordset(p_members) AS x(user_id uuid,area text,cargo text,percentage integer) LOOP
    IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE user_id=member.user_id AND account_id=account_uuid) THEN RAISE EXCEPTION 'Not a member' USING ERRCODE='42501'; END IF;
    IF member.area IS NULL OR member.area NOT IN ('SIN AREA','VENTAS','FIDELIZACION','ADMINISTRATIVA','FINANZAS') OR member.cargo IS NULL OR length(btrim(member.cargo))>80
      OR member.percentage IS NULL OR member.percentage NOT BETWEEN 0 AND 100 THEN RAISE EXCEPTION 'Invalid member'; END IF;
    IF member.percentage>0 AND (member.area<>'VENTAS' OR btrim(member.cargo)='' OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE user_id=member.user_id AND account_role<>'viewer')
      OR NOT public.has_member_permission(member.user_id,'inbox','view') OR NOT public.has_member_permission(member.user_id,'inbox','send')) THEN RAISE EXCEPTION 'Sales access required'; END IF;
    total=total+member.percentage;
    UPDATE public.profiles SET area=CASE WHEN member.area='SIN AREA' THEN NULL ELSE lower(member.area) END,cargo=nullif(btrim(member.cargo),'') WHERE user_id=member.user_id AND account_id=account_uuid;
    INSERT INTO public.member_sales_routing(account_id,user_id,percentage) VALUES(account_uuid,member.user_id,member.percentage)
      ON CONFLICT(account_id,user_id) DO UPDATE SET percentage=EXCLUDED.percentage,current_weight=0;
  END LOOP;
  IF total>100 OR (p_enabled AND total<>100) THEN RAISE EXCEPTION 'Percentages must total 100'; END IF;
  UPDATE public.account_sales_routing SET enabled=p_enabled,version=version+1,
    started_at=CASE WHEN p_enabled AND NOT current_config.enabled THEN now() ELSE started_at END WHERE account_id=account_uuid;
  RETURN current_config.version+1;
END $$;
REVOKE ALL ON FUNCTION public.configure_sales_routing(jsonb,boolean,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.configure_sales_routing(jsonb,boolean,integer) TO authenticated;

-- Self-service profile editing must not change routing authority.
CREATE OR REPLACE FUNCTION public.guard_member_assignment() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF current_user='authenticated' AND (NEW.area IS DISTINCT FROM OLD.area OR NEW.cargo IS DISTINCT FROM OLD.cargo)
    AND NOT public.is_account_member(OLD.account_id,'admin') THEN RAISE EXCEPTION 'Only an administrator may assign area and position' USING ERRCODE='42501'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_member_assignment BEFORE UPDATE OF area,cargo ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.guard_member_assignment();

CREATE TABLE public.conversation_sales_routes (
  conversation_id uuid PRIMARY KEY REFERENCES public.conversations(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  agent_id uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  state text NOT NULL CHECK(state IN ('waiting','assigned')),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.conversation_sales_routes ENABLE ROW LEVEL SECURITY;
CREATE POLICY sales_routes_read ON public.conversation_sales_routes FOR SELECT TO authenticated USING(public.is_account_member(account_id,'admin'));
REVOKE ALL ON public.conversation_sales_routes FROM anon,authenticated;
GRANT SELECT ON public.conversation_sales_routes TO authenticated;
GRANT ALL ON public.conversation_sales_routes TO service_role;

-- Called only by the trusted webhook. Serialize per account so simultaneous
-- leads cannot spend the same weighted rotation position twice.
CREATE OR REPLACE FUNCTION public.route_sales_conversation(p_account_id uuid,p_conversation_id uuid,p_message_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cfg public.account_sales_routing; conv record; inbound record; turns integer; chosen uuid; weight_total integer;
  pool uuid[]; route_exists boolean; tag_uuid uuid; item record; author_uuid uuid; adviser_name text;
BEGIN
  SELECT * INTO cfg FROM public.account_sales_routing WHERE account_id=p_account_id FOR UPDATE;
  IF NOT FOUND OR NOT cfg.enabled THEN RETURN jsonb_build_object('handled',false); END IF;
  SELECT * INTO conv FROM public.conversations WHERE id=p_conversation_id AND account_id=p_account_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('handled',false); END IF;
  SELECT EXISTS(SELECT 1 FROM public.conversation_sales_routes WHERE conversation_id=conv.id) INTO route_exists;
  IF conv.automation_enabled=false AND NOT route_exists THEN RETURN jsonb_build_object('handled',false); END IF;
  IF conv.assigned_agent_id IS NOT NULL THEN RETURN jsonb_build_object('handled',route_exists,'notify',false); END IF;
  SELECT id,created_at INTO inbound FROM public.messages WHERE conversation_id=conv.id AND message_id=p_message_id AND sender_type='customer';
  IF NOT FOUND THEN RETURN jsonb_build_object('handled',false); END IF;
  SELECT count(*) INTO turns FROM (
    SELECT sender_type,lag(sender_type) OVER(ORDER BY created_at,id) AS previous_sender
    FROM public.messages WHERE conversation_id=conv.id AND created_at>=cfg.started_at AND created_at<=inbound.created_at
  ) AS ordered WHERE sender_type='bot' AND previous_sender IS DISTINCT FROM 'bot';
  IF turns<4 THEN RETURN jsonb_build_object('handled',false,'turns',turns); END IF;
  SELECT array_agg(r.user_id),sum(r.percentage) INTO pool,weight_total FROM public.member_sales_routing r
    JOIN public.profiles p ON p.user_id=r.user_id AND p.account_id=r.account_id
    JOIN public.member_presence presence ON presence.user_id=r.user_id AND presence.account_id=r.account_id
    WHERE r.account_id=p_account_id AND r.percentage>0 AND lower(p.area)='ventas' AND p.account_role<>'viewer'
      AND presence.status='online' AND presence.last_seen_at>=now()-interval '75 seconds'
      AND public.has_member_permission(p.user_id,'inbox','view') AND public.has_member_permission(p.user_id,'inbox','send');
  IF coalesce(weight_total,0)>0 THEN
    UPDATE public.member_sales_routing SET current_weight=current_weight+percentage WHERE account_id=p_account_id AND user_id=ANY(pool);
    SELECT user_id INTO chosen FROM public.member_sales_routing WHERE account_id=p_account_id AND user_id=ANY(pool) ORDER BY current_weight DESC,user_id LIMIT 1;
    UPDATE public.member_sales_routing SET current_weight=current_weight-weight_total WHERE account_id=p_account_id AND user_id=chosen;
  END IF;
  UPDATE public.conversations SET assigned_agent_id=chosen,automation_enabled=false,ai_enabled=false,
    ai_handed_off_at=now(),ai_handoff_summary='DERIVACION A VENTAS TRAS CUATRO INTERACCIONES AUTOMATICAS',updated_at=now() WHERE id=conv.id;
  UPDATE public.automation_pending_executions SET status='cancelled' WHERE contact_id=conv.contact_id AND status='pending';
  UPDATE public.flow_runs SET status='handed_off' WHERE conversation_id=conv.id AND status='active';
  INSERT INTO public.conversation_sales_routes(conversation_id,account_id,agent_id,state) VALUES(conv.id,p_account_id,chosen,CASE WHEN chosen IS NULL THEN 'waiting' ELSE 'assigned' END)
    ON CONFLICT(conversation_id) DO UPDATE SET agent_id=EXCLUDED.agent_id,state=EXCLUDED.state;
  SELECT user_id INTO author_uuid FROM public.contacts WHERE id=conv.contact_id AND account_id=p_account_id;
  SELECT coalesce(nullif(btrim(nickname),''),full_name) INTO adviser_name FROM public.profiles WHERE user_id=chosen AND account_id=p_account_id;
  IF author_uuid IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_account_id::text,0));
    FOR item IN SELECT * FROM (VALUES ('AREA VENTAS','#0ea5e9'),
      (CASE WHEN chosen IS NULL THEN 'PENDIENTE DE ASIGNACION VENTAS' ELSE 'ASESOR '||upper(coalesce(adviser_name,'VENTAS')) END,'#8b5cf6')) AS x(label,color) LOOP
      SELECT id INTO tag_uuid FROM public.tags WHERE account_id=p_account_id AND name=item.label ORDER BY created_at LIMIT 1;
      IF tag_uuid IS NULL THEN INSERT INTO public.tags(account_id,user_id,name,color) VALUES(p_account_id,author_uuid,item.label,item.color) RETURNING id INTO tag_uuid; END IF;
      INSERT INTO public.contact_tags(contact_id,tag_id) VALUES(conv.contact_id,tag_uuid) ON CONFLICT DO NOTHING;
    END LOOP;
    IF chosen IS NOT NULL THEN DELETE FROM public.contact_tags ct USING public.tags t WHERE ct.tag_id=t.id AND ct.contact_id=conv.contact_id AND t.account_id=p_account_id AND t.name='PENDIENTE DE ASIGNACION VENTAS'; END IF;
  END IF;
  RETURN jsonb_build_object('handled',true,'assigned',chosen IS NOT NULL,'agent_id',chosen,'notify',NOT route_exists OR chosen IS NOT NULL);
END $$;
REVOKE ALL ON FUNCTION public.route_sales_conversation(uuid,uuid,text) FROM PUBLIC,authenticated;
GRANT EXECUTE ON FUNCTION public.route_sales_conversation(uuid,uuid,text) TO service_role;
NOTIFY pgrst,'reload schema';
