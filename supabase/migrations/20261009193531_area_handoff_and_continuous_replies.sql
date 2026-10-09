ALTER TABLE public.ai_configs DROP CONSTRAINT ai_configs_auto_reply_max_per_conversation_check;
ALTER TABLE public.ai_configs ADD CONSTRAINT ai_configs_auto_reply_max_per_conversation_check CHECK(auto_reply_max_per_conversation BETWEEN 1 AND 1000);
ALTER TABLE public.conversations ADD COLUMN ai_handoff_area text CHECK(ai_handoff_area IN ('VENTAS','FIDELIZACION'));

-- A shared fidelity queue is not a percentage-based sales allocation.
CREATE FUNCTION crm_private.sync_inbox_area() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target_area text; tag_id uuid; boundary timestamptz;
BEGIN
  IF NEW.assigned_agent_id IS NULL THEN RETURN NEW; END IF;
  SELECT upper(btrim(area)) INTO target_area FROM public.profiles WHERE user_id=NEW.assigned_agent_id AND account_id=NEW.account_id;
  IF target_area NOT IN ('VENTAS','FIDELIZACION') THEN RETURN NEW; END IF;
  UPDATE public.conversations SET ai_handoff_area=CASE WHEN target_area='FIDELIZACION' THEN target_area ELSE NULL END WHERE id=NEW.id;
  DELETE FROM public.contact_tags ct USING public.tags t WHERE ct.tag_id=t.id AND ct.contact_id=NEW.contact_id AND t.account_id=NEW.account_id
    AND t.name IN ('AREA VENTAS','AREA FIDELIZACION','PENDIENTE DE ASIGNACION VENTAS') AND t.name<>'AREA '||target_area;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.account_id::text,0));
  SELECT id INTO tag_id FROM public.tags WHERE account_id=NEW.account_id AND name='AREA '||target_area ORDER BY created_at LIMIT 1;
  IF tag_id IS NULL THEN
    INSERT INTO public.tags(account_id,user_id,name,color,kind,audience) VALUES(NEW.account_id,NEW.user_id,'AREA '||target_area,'#06b6d4',
      CASE WHEN target_area='FIDELIZACION' THEN 'access' ELSE 'process' END,
      CASE WHEN target_area='FIDELIZACION' THEN '{"users":[],"areas":["FIDELIZACION"],"roles":[]}'::jsonb ELSE '{"users":[],"areas":[],"roles":[]}'::jsonb END) RETURNING id INTO tag_id;
  END IF;
  INSERT INTO public.contact_tags(contact_id,tag_id) VALUES(NEW.contact_id,tag_id) ON CONFLICT DO NOTHING;
  IF target_area='FIDELIZACION' THEN
    SELECT coalesce(max(created_at),now()) INTO boundary FROM public.messages WHERE conversation_id=NEW.id AND sender_type='customer';
    INSERT INTO crm_private.conversation_history_grants(conversation_id,user_id,visible_from)
      SELECT NEW.id,p.user_id,boundary FROM public.profiles p WHERE p.account_id=NEW.account_id AND upper(btrim(p.area))='FIDELIZACION' ON CONFLICT DO NOTHING;
    UPDATE public.conversation_sales_routes SET lease_expires_at=NULL WHERE conversation_id=NEW.id;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION crm_private.sync_inbox_area() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER zz_sync_inbox_area AFTER UPDATE OF assigned_agent_id ON public.conversations FOR EACH ROW
WHEN (OLD.assigned_agent_id IS DISTINCT FROM NEW.assigned_agent_id) EXECUTE FUNCTION crm_private.sync_inbox_area();

CREATE FUNCTION public.route_conversation_area(p_account uuid,p_conversation uuid,p_area text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE conv record; chosen uuid; label uuid; area_key text=upper(btrim(p_area)); boundary timestamptz;
BEGIN
  IF area_key NOT IN ('VENTAS','FIDELIZACION') THEN RAISE EXCEPTION 'Area invalida'; END IF;
  SELECT * INTO conv FROM public.conversations WHERE id=p_conversation AND account_id=p_account FOR NO KEY UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Chat no encontrado'; END IF;
  SELECT p.user_id INTO chosen FROM public.profiles p JOIN public.member_presence mp ON mp.user_id=p.user_id AND mp.account_id=p.account_id
    WHERE p.account_id=p_account AND upper(btrim(p.area))=area_key AND mp.status IN ('online','away') AND mp.last_seen_at>now()-interval '75 seconds'
    AND coalesce(nullif(btrim(p.nickname),''),nullif(btrim(p.full_name),'')) IS NOT NULL
    AND public.has_member_permission(p.user_id,'inbox','view') AND public.has_member_permission(p.user_id,'inbox','send')
    ORDER BY CASE mp.status WHEN 'online' THEN 0 ELSE 1 END,
      (SELECT count(*) FROM public.conversations c WHERE c.assigned_agent_id=p.user_id AND c.status<>'closed'),p.user_id LIMIT 1;
  UPDATE public.conversations SET assigned_agent_id=chosen,ai_handoff_area=area_key,updated_at=now() WHERE id=conv.id;
  IF area_key='FIDELIZACION' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_account::text,0));
    DELETE FROM public.contact_tags ct USING public.tags t WHERE ct.tag_id=t.id AND ct.contact_id=conv.contact_id AND t.account_id=p_account AND t.name IN ('AREA VENTAS','PENDIENTE DE ASIGNACION VENTAS');
    SELECT id INTO label FROM public.tags WHERE account_id=p_account AND name='AREA FIDELIZACION' ORDER BY created_at LIMIT 1;
    IF label IS NULL THEN INSERT INTO public.tags(account_id,user_id,name,color,kind,audience) VALUES(p_account,conv.user_id,'AREA FIDELIZACION','#06b6d4','access','{"users":[],"areas":["FIDELIZACION"],"roles":[]}'::jsonb) RETURNING id INTO label; END IF;
    INSERT INTO public.contact_tags(contact_id,tag_id) VALUES(conv.contact_id,label) ON CONFLICT DO NOTHING;
    SELECT coalesce(max(created_at),now()) INTO boundary FROM public.messages WHERE conversation_id=conv.id AND sender_type='customer';
    INSERT INTO crm_private.conversation_history_grants(conversation_id,user_id,visible_from) SELECT conv.id,p.user_id,boundary FROM public.profiles p WHERE p.account_id=p_account AND upper(btrim(p.area))='FIDELIZACION' ON CONFLICT DO NOTHING;
  END IF;
  RETURN jsonb_build_object('agent_id',chosen,'area',area_key);
END $$;
REVOKE ALL ON FUNCTION public.route_conversation_area(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.route_conversation_area(uuid,uuid,text) TO service_role;

CREATE FUNCTION public.route_waiting_area_conversations() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c record; r jsonb; total integer=0;
BEGIN
  FOR c IN SELECT id,account_id,ai_handoff_area FROM public.conversations WHERE ai_handoff_area IS NOT NULL AND assigned_agent_id IS NULL AND status<>'closed' ORDER BY updated_at LIMIT 100 LOOP
    r=public.route_conversation_area(c.account_id,c.id,c.ai_handoff_area);
    IF r->>'agent_id' IS NOT NULL THEN total=total+1; END IF;
  END LOOP;
  RETURN total;
END $$;
REVOKE ALL ON FUNCTION public.route_waiting_area_conversations() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.route_waiting_area_conversations() TO service_role;
