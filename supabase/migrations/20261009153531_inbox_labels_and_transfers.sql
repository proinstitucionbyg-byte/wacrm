INSERT INTO public.permission_definitions(module,action,label,description) VALUES
('tags','manage','Administrar catálogo de etiquetas','Crear etiquetas, colores y destinatarios; otorgado por CEO o administración'),
('inbox','supervise','Supervisar todas las conversaciones','Consultar todos los chats del equipo, incluido su historial')
ON CONFLICT(module,action) DO NOTHING;

ALTER TABLE public.tags ADD COLUMN kind text NOT NULL DEFAULT 'process' CHECK(kind IN ('process','access','system')),
  ADD COLUMN audience jsonb NOT NULL DEFAULT '{"users":[],"areas":[],"roles":[]}';
CREATE TABLE crm_private.conversation_history_grants (
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  visible_from timestamptz NOT NULL, PRIMARY KEY(conversation_id,user_id)
);
ALTER TABLE crm_private.conversation_history_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm_private.conversation_history_grants FROM PUBLIC,anon,authenticated;

CREATE FUNCTION crm_private.tag_matches(p_tag_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS(SELECT 1 FROM public.tags t JOIN public.profiles p ON p.account_id=t.account_id AND p.user_id=auth.uid()
    WHERE t.id=p_tag_id AND (
      (t.audience->'users') ? p.user_id::text OR
      (t.audience->'areas') ? upper(btrim(coalesce(p.area,''))) OR
      (t.audience->'roles') ? p.account_role::text OR
      ((t.audience->'roles') ? 'coordinator' AND public.has_member_permission(p.user_id,'inbox','supervise')) OR
      (t.kind='process' AND t.audience='{"users":[],"areas":[],"roles":[]}'::jsonb)
    ))
$$;
REVOKE ALL ON FUNCTION crm_private.tag_matches(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION crm_private.tag_matches(uuid) TO authenticated;

CREATE FUNCTION crm_private.inbox_visible_from(p_conversation_id uuid) RETURNS timestamptz
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE conv record; viewer record; boundary timestamptz; has_access boolean;
BEGIN
  SELECT * INTO conv FROM public.conversations WHERE id=p_conversation_id;
  SELECT * INTO viewer FROM public.profiles WHERE user_id=auth.uid() AND account_id=conv.account_id;
  IF NOT FOUND OR NOT public.has_member_permission(viewer.user_id,'inbox','view') THEN RETURN NULL; END IF;
  IF viewer.account_role IN ('owner','admin') OR public.has_member_permission(viewer.user_id,'inbox','supervise') THEN RETURN '-infinity'; END IF;
  has_access=conv.assigned_agent_id=viewer.user_id AND NOT EXISTS(
    SELECT 1 FROM public.conversation_sales_routes r WHERE r.conversation_id=conv.id AND (r.state='expired' OR r.lease_expires_at<=now())
  );
  has_access=coalesce(has_access,false) OR EXISTS(SELECT 1 FROM public.contact_tags ct JOIN public.tags t ON t.id=ct.tag_id
    WHERE ct.contact_id=conv.contact_id AND t.kind='access' AND crm_private.tag_matches(t.id));
  IF NOT has_access THEN RETURN NULL; END IF;
  SELECT visible_from INTO boundary FROM crm_private.conversation_history_grants WHERE conversation_id=conv.id AND user_id=viewer.user_id;
  RETURN coalesce(boundary,'-infinity'::timestamptz);
END $$;
REVOKE ALL ON FUNCTION crm_private.inbox_visible_from(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION crm_private.inbox_visible_from(uuid) TO authenticated;

DROP POLICY conversations_select ON public.conversations;
DROP POLICY conversations_update ON public.conversations;
DROP POLICY conversations_delete ON public.conversations;
CREATE POLICY conversations_select ON public.conversations FOR SELECT TO authenticated USING(crm_private.inbox_visible_from(id) IS NOT NULL);
CREATE POLICY conversations_update ON public.conversations FOR UPDATE TO authenticated
  USING(crm_private.inbox_visible_from(id) IS NOT NULL AND public.has_member_permission(auth.uid(),'inbox','send'))
  WITH CHECK(public.is_account_member(account_id));
CREATE POLICY conversations_delete ON public.conversations FOR DELETE TO authenticated USING(public.is_account_member(account_id,'admin'));
DROP POLICY messages_select ON public.messages;
DROP POLICY messages_modify ON public.messages;
CREATE POLICY messages_select ON public.messages FOR SELECT TO authenticated USING(created_at>=crm_private.inbox_visible_from(conversation_id));
CREATE POLICY messages_insert ON public.messages FOR INSERT TO authenticated WITH CHECK(
  created_at>=crm_private.inbox_visible_from(conversation_id) AND sender_type='agent' AND sender_id=auth.uid()
  AND EXISTS(SELECT 1 FROM public.conversations c WHERE c.id=conversation_id AND public.has_member_permission(auth.uid(),'inbox','send')));
CREATE POLICY messages_update ON public.messages FOR UPDATE TO authenticated
  USING(created_at>=crm_private.inbox_visible_from(conversation_id) AND public.has_member_permission(auth.uid(),'inbox','send'))
  WITH CHECK(created_at>=crm_private.inbox_visible_from(conversation_id));
CREATE POLICY messages_delete ON public.messages FOR DELETE TO authenticated
  USING(created_at>=crm_private.inbox_visible_from(conversation_id) AND public.has_member_permission(auth.uid(),'inbox','delete'));

DROP POLICY tags_select ON public.tags;
DROP POLICY tags_insert ON public.tags;
DROP POLICY tags_update ON public.tags;
DROP POLICY tags_delete ON public.tags;
CREATE POLICY tags_select ON public.tags FOR SELECT TO authenticated USING(public.is_account_member(account_id) AND (
  public.has_member_permission(auth.uid(),'tags','manage') OR crm_private.tag_matches(id)));
-- Catalog writes are atomic and validated by the RPC below.
REVOKE INSERT,UPDATE,DELETE ON public.tags FROM authenticated;

CREATE FUNCTION public.save_inbox_tag(p_id uuid,p_name text,p_color text,p_kind text,p_audience jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE account uuid; result uuid; item text;
BEGIN
  SELECT account_id INTO account FROM public.profiles WHERE user_id=auth.uid();
  IF account IS NULL OR NOT public.has_member_permission(auth.uid(),'tags','manage') THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
  IF length(btrim(p_name)) NOT BETWEEN 1 AND 80 OR p_color !~ '^#[0-9A-Fa-f]{6}$' OR p_kind NOT IN ('process','access')
    OR jsonb_typeof(p_audience) IS DISTINCT FROM 'object' OR jsonb_typeof(p_audience->'users') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_audience->'areas') IS DISTINCT FROM 'array' OR jsonb_typeof(p_audience->'roles') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Etiqueta invalida'; END IF;
  IF p_kind='access' AND jsonb_array_length(p_audience->'users')+jsonb_array_length(p_audience->'areas')+jsonb_array_length(p_audience->'roles')=0 THEN RAISE EXCEPTION 'Selecciona destinatarios'; END IF;
  FOR item IN SELECT jsonb_array_elements_text(p_audience->'users') LOOP
    IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE user_id=item::uuid AND account_id=account) THEN RAISE EXCEPTION 'Destinatario de otra cuenta'; END IF;
  END LOOP;
  FOR item IN SELECT jsonb_array_elements_text(p_audience->'roles') LOOP
    IF item NOT IN ('owner','admin','coordinator') THEN RAISE EXCEPTION 'Rol invalido'; END IF;
  END LOOP;
  IF p_id IS NULL THEN
    INSERT INTO public.tags(account_id,user_id,name,color,kind,audience) VALUES(account,auth.uid(),upper(btrim(p_name)),p_color,p_kind,p_audience) RETURNING id INTO result;
  ELSE
    UPDATE public.tags SET name=upper(btrim(p_name)),color=p_color,kind=p_kind,audience=p_audience WHERE id=p_id AND account_id=account AND kind<>'system' RETURNING id INTO result;
    IF result IS NULL THEN RAISE EXCEPTION 'Etiqueta no editable'; END IF;
  END IF;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.save_inbox_tag(uuid,text,text,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_inbox_tag(uuid,text,text,text,jsonb) TO authenticated;

CREATE FUNCTION public.delete_inbox_tag(p_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NOT public.has_member_permission(auth.uid(),'tags','manage') THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
  DELETE FROM public.tags WHERE id=p_id AND kind<>'system' AND public.is_account_member(account_id);
END $$;
REVOKE ALL ON FUNCTION public.delete_inbox_tag(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.delete_inbox_tag(uuid) TO authenticated;

CREATE FUNCTION public.tag_conversations(p_conversations uuid[],p_tag uuid,p_remove boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE item uuid; conv record; label public.tags; recipient uuid; same_area boolean;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_member_permission(auth.uid(),'inbox','tag') OR coalesce(cardinality(p_conversations),0) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
  SELECT * INTO label FROM public.tags WHERE id=p_tag AND public.is_account_member(account_id);
  IF NOT FOUND OR (NOT public.has_member_permission(auth.uid(),'tags','manage') AND (label.kind<>'process' OR NOT crm_private.tag_matches(label.id))) THEN RAISE EXCEPTION 'Etiqueta no permitida' USING ERRCODE='42501'; END IF;
  FOR item IN SELECT DISTINCT unnest(p_conversations) LOOP
    IF crm_private.inbox_visible_from(item) IS NULL THEN RAISE EXCEPTION 'Chat no autorizado' USING ERRCODE='42501'; END IF;
    SELECT * INTO conv FROM public.conversations WHERE id=item FOR NO KEY UPDATE;
    IF conv.account_id<>label.account_id THEN RAISE EXCEPTION 'Otra cuenta' USING ERRCODE='42501'; END IF;
    IF label.kind='system' THEN
      recipient=(label.audience->'users'->>0)::uuid;
      IF recipient IS NULL THEN RAISE EXCEPTION 'Etiqueta de responsable invalida'; END IF;
      SELECT coalesce(lower(a.area)=lower(b.area),false) INTO same_area FROM public.profiles a JOIN public.profiles b ON b.user_id=recipient WHERE a.user_id=coalesce(conv.assigned_agent_id,auth.uid());
      IF NOT p_remove THEN PERFORM public.transfer_inbox_conversation(conv.id,recipient,coalesce(same_area,false));
      ELSIF conv.assigned_agent_id=recipient THEN PERFORM public.transfer_inbox_conversation(conv.id,NULL,true); END IF;
      CONTINUE;
    END IF;
    IF p_remove THEN DELETE FROM public.contact_tags WHERE contact_id=conv.contact_id AND tag_id=p_tag;
    ELSE INSERT INTO public.contact_tags(contact_id,tag_id) VALUES(conv.contact_id,p_tag) ON CONFLICT DO NOTHING; END IF;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.tag_conversations(uuid[],uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.tag_conversations(uuid[],uuid,boolean) TO authenticated;

-- Close the direct contact-tag path too; permitted state tags remain usable.
DROP POLICY contact_tags_modify ON public.contact_tags;
CREATE POLICY contact_tags_insert ON public.contact_tags FOR INSERT TO authenticated WITH CHECK(
  public.has_member_permission(auth.uid(),'inbox','tag') AND EXISTS(SELECT 1 FROM public.tags t JOIN public.contacts c ON c.account_id=t.account_id
    WHERE t.id=tag_id AND c.id=contact_id AND t.kind='process' AND crm_private.tag_matches(t.id)
      AND EXISTS(SELECT 1 FROM public.conversations v WHERE v.contact_id=c.id AND crm_private.inbox_visible_from(v.id) IS NOT NULL)));
CREATE POLICY contact_tags_delete ON public.contact_tags FOR DELETE TO authenticated USING(
  public.has_member_permission(auth.uid(),'inbox','tag') AND EXISTS(SELECT 1 FROM public.tags t JOIN public.contacts c ON c.account_id=t.account_id
    WHERE t.id=tag_id AND c.id=contact_id AND t.kind='process' AND crm_private.tag_matches(t.id)
      AND EXISTS(SELECT 1 FROM public.conversations v WHERE v.contact_id=c.id AND crm_private.inbox_visible_from(v.id) IS NOT NULL)));

CREATE FUNCTION crm_private.guard_inbox_assignment() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NEW.assigned_agent_id IS DISTINCT FROM OLD.assigned_agent_id THEN
    IF auth.uid() IS NOT NULL AND (NOT public.has_member_permission(auth.uid(),'inbox','assign') OR current_setting('crm.transfer_authorized',true) IS DISTINCT FROM '1') THEN
      RAISE EXCEPTION 'Utiliza el traspaso de conversaciones' USING ERRCODE='42501';
    END IF;
    IF NEW.assigned_agent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.profiles WHERE user_id=NEW.assigned_agent_id AND account_id=NEW.account_id) THEN RAISE EXCEPTION 'Destinatario de otra cuenta' USING ERRCODE='42501'; END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION crm_private.guard_inbox_assignment() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_inbox_assignment BEFORE UPDATE OF assigned_agent_id ON public.conversations FOR EACH ROW EXECUTE FUNCTION crm_private.guard_inbox_assignment();

CREATE FUNCTION crm_private.sync_inbox_assignment() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE previous public.conversation_sales_routes; recipient record; label uuid;
BEGIN
  IF NEW.assigned_agent_id IS NOT DISTINCT FROM OLD.assigned_agent_id THEN RETURN NEW; END IF;
  SELECT * INTO previous FROM public.conversation_sales_routes WHERE conversation_id=NEW.id FOR UPDATE;
  DELETE FROM public.contact_tags ct WHERE ct.contact_id=NEW.contact_id AND ct.tag_id=previous.assignment_tag_id AND NOT EXISTS(
    SELECT 1 FROM public.conversation_sales_routes r JOIN public.conversations c ON c.id=r.conversation_id
    WHERE r.conversation_id<>NEW.id AND c.contact_id=NEW.contact_id AND r.state='assigned' AND r.assignment_tag_id=ct.tag_id);
  IF NEW.assigned_agent_id IS NOT NULL THEN
    SELECT * INTO recipient FROM public.profiles WHERE user_id=NEW.assigned_agent_id AND account_id=NEW.account_id;
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.account_id::text,0));
    SELECT id INTO label FROM public.tags WHERE account_id=NEW.account_id AND kind='system' AND audience->'users' ? NEW.assigned_agent_id::text ORDER BY created_at LIMIT 1;
    IF label IS NULL THEN
      INSERT INTO public.tags(account_id,user_id,name,color,kind,audience) VALUES(NEW.account_id,NEW.user_id,
        'ASESOR '||upper(coalesce(nullif(btrim(recipient.nickname),''),recipient.full_name)),'#8b5cf6','system',jsonb_build_object('users',jsonb_build_array(NEW.assigned_agent_id::text),'areas','[]'::jsonb,'roles','[]'::jsonb)) RETURNING id INTO label;
    END IF;
    INSERT INTO public.contact_tags(contact_id,tag_id) VALUES(NEW.contact_id,label) ON CONFLICT DO NOTHING;
    INSERT INTO crm_private.conversation_history_grants(conversation_id,user_id,visible_from) VALUES(NEW.id,NEW.assigned_agent_id,'-infinity') ON CONFLICT DO NOTHING;
  END IF;
  INSERT INTO public.conversation_sales_routes(conversation_id,account_id,agent_id,state,lease_started_at,lease_expires_at,assignment_tag_id)
    VALUES(NEW.id,NEW.account_id,NEW.assigned_agent_id,CASE WHEN NEW.assigned_agent_id IS NULL THEN 'expired' ELSE 'assigned' END,now(),CASE WHEN NEW.assigned_agent_id IS NOT NULL THEN now()+interval '2 hours' END,label)
    ON CONFLICT(conversation_id) DO UPDATE SET agent_id=EXCLUDED.agent_id,state=EXCLUDED.state,lease_started_at=EXCLUDED.lease_started_at,
      lease_expires_at=EXCLUDED.lease_expires_at,assignment_tag_id=EXCLUDED.assignment_tag_id,last_agent_message_at=NULL,last_agent_message_id=NULL;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION crm_private.sync_inbox_assignment() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER sync_inbox_assignment AFTER UPDATE OF assigned_agent_id ON public.conversations FOR EACH ROW EXECUTE FUNCTION crm_private.sync_inbox_assignment();

-- Attach responsible labels to assignments that existed before this release.
DO $$
DECLARE item record; label uuid;
BEGIN
  FOR item IN SELECT r.conversation_id,r.account_id,r.agent_id,c.contact_id,c.user_id,
    'ASESOR '||upper(coalesce(nullif(btrim(p.nickname),''),p.full_name,'SIN APODO')) AS label_name
    FROM public.conversation_sales_routes r JOIN public.conversations c ON c.id=r.conversation_id
    JOIN public.profiles p ON p.user_id=r.agent_id AND p.account_id=r.account_id
    WHERE r.state='assigned' AND c.assigned_agent_id=r.agent_id LOOP
    SELECT id INTO label FROM public.tags WHERE account_id=item.account_id AND kind='system' AND audience->'users' ? item.agent_id::text LIMIT 1;
    IF label IS NULL THEN
      INSERT INTO public.tags(account_id,user_id,name,color,kind,audience) VALUES(item.account_id,item.user_id,item.label_name,'#8b5cf6','system',jsonb_build_object('users',jsonb_build_array(item.agent_id::text),'areas','[]'::jsonb,'roles','[]'::jsonb)) RETURNING id INTO label;
    END IF;
    DELETE FROM public.contact_tags ct USING public.tags t WHERE ct.tag_id=t.id AND ct.contact_id=item.contact_id AND t.account_id=item.account_id AND t.kind='process' AND t.name=item.label_name;
    INSERT INTO public.contact_tags(contact_id,tag_id) VALUES(item.contact_id,label) ON CONFLICT DO NOTHING;
    UPDATE public.conversation_sales_routes SET assignment_tag_id=label WHERE conversation_id=item.conversation_id;
  END LOOP;
END $$;

CREATE FUNCTION public.route_waiting_sales_conversations() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE candidate record; result jsonb; total integer=0;
BEGIN
  FOR candidate IN SELECT r.account_id,r.conversation_id,
    (SELECT m.message_id FROM public.messages m WHERE m.conversation_id=r.conversation_id AND m.sender_type='customer' ORDER BY m.created_at DESC,m.id DESC LIMIT 1) AS inbound_id
    FROM public.conversation_sales_routes r WHERE r.state='waiting' ORDER BY r.created_at LIMIT 100 LOOP
    IF candidate.inbound_id IS NULL THEN CONTINUE; END IF;
    result=public.route_sales_conversation(candidate.account_id,candidate.conversation_id,candidate.inbound_id);
    IF coalesce((result->>'assigned')::boolean,false) THEN total=total+1; END IF;
  END LOOP;
  RETURN total;
END $$;
REVOKE ALL ON FUNCTION public.route_waiting_sales_conversations() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.route_waiting_sales_conversations() TO service_role;

CREATE FUNCTION public.transfer_inbox_conversation(p_conversation uuid,p_agent uuid,p_full_history boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE conv record; recipient record; boundary timestamptz;
BEGIN
  IF NOT public.has_member_permission(auth.uid(),'inbox','assign') OR crm_private.inbox_visible_from(p_conversation) IS NULL THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
  SELECT * INTO conv FROM public.conversations WHERE id=p_conversation FOR NO KEY UPDATE;
  IF p_agent IS NOT NULL THEN
    SELECT * INTO recipient FROM public.profiles WHERE user_id=p_agent AND account_id=conv.account_id;
    IF NOT FOUND OR NOT public.has_member_permission(p_agent,'inbox','view') OR NOT public.has_member_permission(p_agent,'inbox','send') THEN RAISE EXCEPTION 'Destinatario sin acceso' USING ERRCODE='42501'; END IF;
  END IF;
  PERFORM set_config('crm.transfer_authorized','1',true);
  UPDATE public.conversations SET assigned_agent_id=p_agent,updated_at=now() WHERE id=conv.id;
  PERFORM set_config('crm.transfer_authorized','0',true);
  IF p_agent IS NOT NULL THEN
    SELECT max(created_at) INTO boundary FROM public.messages WHERE conversation_id=conv.id AND sender_type='customer';
    INSERT INTO crm_private.conversation_history_grants(conversation_id,user_id,visible_from) VALUES(conv.id,p_agent,
      CASE WHEN p_full_history THEN '-infinity'::timestamptz ELSE coalesce(boundary,now()) END)
      ON CONFLICT(conversation_id,user_id) DO UPDATE SET visible_from=EXCLUDED.visible_from;
  END IF;
  RETURN jsonb_build_object('agent_id',p_agent,'full_history',p_full_history);
END $$;
REVOKE ALL ON FUNCTION public.transfer_inbox_conversation(uuid,uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.transfer_inbox_conversation(uuid,uuid,boolean) TO authenticated;
CREATE FUNCTION public.set_inbox_ai_pause(p_conversation uuid,p_paused boolean,p_assign_to_me boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_member_permission(auth.uid(),'inbox','send') OR crm_private.inbox_visible_from(p_conversation) IS NULL THEN RAISE EXCEPTION 'Sin acceso' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.conversations WHERE id=p_conversation FOR NO KEY UPDATE;
  IF p_assign_to_me OR NOT p_paused THEN
    PERFORM public.transfer_inbox_conversation(p_conversation,CASE WHEN p_paused THEN auth.uid() ELSE NULL END,true);
  END IF;
  UPDATE public.conversations SET ai_autoreply_disabled=p_paused,
    ai_reply_count=CASE WHEN p_paused THEN ai_reply_count ELSE 0 END,
    ai_handoff_summary=CASE WHEN p_paused THEN ai_handoff_summary ELSE NULL END
  WHERE id=p_conversation;
END $$;
REVOKE ALL ON FUNCTION public.set_inbox_ai_pause(uuid,boolean,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_inbox_ai_pause(uuid,boolean,boolean) TO authenticated;
NOTIFY pgrst,'reload schema';
