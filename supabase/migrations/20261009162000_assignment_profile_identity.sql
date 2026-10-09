CREATE OR REPLACE FUNCTION public.route_sales_conversation(p_account_id uuid,p_conversation_id uuid,p_message_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cfg public.account_sales_routing; conv record; inbound record; turns integer; chosen uuid; weight_total integer;
  pool uuid[]; route_exists boolean; tag_uuid uuid; item record; author_uuid uuid; adviser_name text;
BEGIN
  SELECT * INTO cfg FROM public.account_sales_routing WHERE account_id=p_account_id FOR UPDATE;
  IF NOT FOUND OR NOT cfg.enabled THEN RETURN jsonb_build_object('handled',false); END IF;
  SELECT * INTO conv FROM public.conversations WHERE id=p_conversation_id AND account_id=p_account_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('handled',false); END IF;
  PERFORM crm_private.expire_sales_assignment(conv.id);
  SELECT EXISTS(SELECT 1 FROM public.conversation_sales_routes WHERE conversation_id=conv.id) INTO route_exists;
  IF EXISTS(SELECT 1 FROM public.conversation_sales_routes WHERE conversation_id=conv.id AND state='expired') THEN RETURN jsonb_build_object('handled',false); END IF;
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
    WHERE r.account_id=p_account_id AND r.percentage>0 AND lower(p.area)='ventas' AND p.account_role<>'viewer' AND coalesce(nullif(btrim(p.nickname),''),nullif(btrim(p.full_name),'')) IS NOT NULL
      AND presence.status='online' AND presence.last_seen_at>=now()-interval '75 seconds'
      AND public.has_member_permission(p.user_id,'inbox','view') AND public.has_member_permission(p.user_id,'inbox','send');
  IF coalesce(weight_total,0)>0 THEN
    UPDATE public.member_sales_routing SET current_weight=current_weight+percentage WHERE account_id=p_account_id AND user_id=ANY(pool);
    SELECT user_id INTO chosen FROM public.member_sales_routing WHERE account_id=p_account_id AND user_id=ANY(pool) ORDER BY current_weight DESC,user_id LIMIT 1;
    UPDATE public.member_sales_routing SET current_weight=current_weight-weight_total WHERE account_id=p_account_id AND user_id=chosen;
  END IF;
  -- Assignment exposes the lead to its adviser; it is not a human takeover.
  -- Preserve AI/automation flags, scheduled executions and the active flow.
  UPDATE public.conversations SET assigned_agent_id=chosen,updated_at=now() WHERE id=conv.id;
  INSERT INTO public.conversation_sales_routes(conversation_id,account_id,agent_id,state) VALUES(conv.id,p_account_id,chosen,CASE WHEN chosen IS NULL THEN 'waiting' ELSE 'assigned' END)
    ON CONFLICT(conversation_id) DO UPDATE SET agent_id=EXCLUDED.agent_id,state=EXCLUDED.state;
  UPDATE public.conversation_sales_routes SET lease_started_at=now(),lease_expires_at=now()+interval '2 hours',last_agent_message_at=NULL,last_agent_message_id=NULL WHERE conversation_id=conv.id AND chosen IS NOT NULL;
  SELECT user_id INTO author_uuid FROM public.contacts WHERE id=conv.contact_id AND account_id=p_account_id;
  SELECT coalesce(nullif(btrim(nickname),''),full_name) INTO adviser_name FROM public.profiles WHERE user_id=chosen AND account_id=p_account_id;
  IF author_uuid IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_account_id::text,0));
    FOR item IN SELECT * FROM (VALUES ('AREA VENTAS','#0ea5e9'),
      (CASE WHEN chosen IS NULL THEN 'PENDIENTE DE ASIGNACION VENTAS' ELSE 'AREA VENTAS' END,'#8b5cf6')) AS x(label,color) LOOP
      SELECT id INTO tag_uuid FROM public.tags WHERE account_id=p_account_id AND name=item.label ORDER BY created_at LIMIT 1;
      IF tag_uuid IS NULL THEN INSERT INTO public.tags(account_id,user_id,name,color) VALUES(p_account_id,author_uuid,item.label,item.color) RETURNING id INTO tag_uuid; END IF;

      INSERT INTO public.contact_tags(contact_id,tag_id) VALUES(conv.contact_id,tag_uuid) ON CONFLICT DO NOTHING;
    END LOOP;
    IF chosen IS NOT NULL THEN DELETE FROM public.contact_tags ct USING public.tags t WHERE ct.tag_id=t.id AND ct.contact_id=conv.contact_id AND t.account_id=p_account_id AND t.name='PENDIENTE DE ASIGNACION VENTAS'; END IF;
  END IF;
  RETURN jsonb_build_object('handled',true,'assigned',chosen IS NOT NULL,'agent_id',chosen,'notify',NOT route_exists OR chosen IS NOT NULL);
END $$;
REVOKE ALL ON FUNCTION public.route_sales_conversation(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.route_sales_conversation(uuid,uuid,text) TO service_role;
NOTIFY pgrst,'reload schema';


-- Never attribute an actual adviser sale to INSTITUCION because the profile has no identity.
CREATE OR REPLACE FUNCTION crm_private.require_assignment_identity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NEW.assigned_agent_id IS NOT NULL AND NEW.assigned_agent_id IS DISTINCT FROM OLD.assigned_agent_id
    AND NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.user_id=NEW.assigned_agent_id AND p.account_id=NEW.account_id
      AND coalesce(nullif(btrim(p.nickname),''),nullif(btrim(p.full_name),'')) IS NOT NULL) THEN
    RAISE EXCEPTION 'Completa el APODO o nombre del miembro antes de asignarle conversaciones.' USING ERRCODE='22023';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION crm_private.require_assignment_identity() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER require_assignment_identity BEFORE UPDATE OF assigned_agent_id ON public.conversations FOR EACH ROW EXECUTE FUNCTION crm_private.require_assignment_identity();