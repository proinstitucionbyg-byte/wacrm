CREATE OR REPLACE FUNCTION public.route_conversation_area(p_account uuid,p_conversation uuid,p_area text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE conv record; chosen uuid; label uuid; area_key text=upper(btrim(p_area)); boundary timestamptz; pool uuid[]; weight_total integer;
BEGIN
  IF area_key NOT IN ('VENTAS','FIDELIZACION') THEN RAISE EXCEPTION 'Area invalida'; END IF;
  SELECT * INTO conv FROM public.conversations WHERE id=p_conversation AND account_id=p_account FOR NO KEY UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Chat no encontrado'; END IF;
  IF area_key='VENTAS' THEN
    IF EXISTS(SELECT 1 FROM public.profiles WHERE account_id=p_account AND user_id=conv.assigned_agent_id AND upper(btrim(area))='VENTAS') THEN
      RETURN jsonb_build_object('agent_id',conv.assigned_agent_id,'area',area_key);
    END IF;
    PERFORM 1 FROM public.account_sales_routing WHERE account_id=p_account AND enabled FOR UPDATE;
    IF FOUND THEN
      SELECT array_agg(r.user_id),sum(r.percentage) INTO pool,weight_total FROM public.member_sales_routing r
      JOIN public.profiles p ON p.user_id=r.user_id AND p.account_id=r.account_id
      JOIN public.member_presence mp ON mp.user_id=p.user_id AND mp.account_id=p.account_id
      WHERE r.account_id=p_account AND r.percentage>0 AND upper(btrim(p.area))='VENTAS' AND mp.status='online' AND mp.last_seen_at>now()-interval '75 seconds'
      AND coalesce(nullif(btrim(p.nickname),''),nullif(btrim(p.full_name),'')) IS NOT NULL
      AND public.has_member_permission(p.user_id,'inbox','view') AND public.has_member_permission(p.user_id,'inbox','send');
      IF coalesce(weight_total,0)>0 THEN
        UPDATE public.member_sales_routing SET current_weight=current_weight+percentage WHERE account_id=p_account AND user_id=ANY(pool);
        SELECT user_id INTO chosen FROM public.member_sales_routing WHERE account_id=p_account AND user_id=ANY(pool) ORDER BY current_weight DESC,user_id LIMIT 1;
        UPDATE public.member_sales_routing SET current_weight=current_weight-weight_total WHERE account_id=p_account AND user_id=chosen;
      END IF;
    END IF;
  ELSE
  SELECT p.user_id INTO chosen FROM public.profiles p JOIN public.member_presence mp ON mp.user_id=p.user_id AND mp.account_id=p.account_id
    WHERE p.account_id=p_account AND upper(btrim(p.area))=area_key AND mp.status IN ('online','away') AND mp.last_seen_at>now()-interval '75 seconds'
    AND coalesce(nullif(btrim(p.nickname),''),nullif(btrim(p.full_name),'')) IS NOT NULL
    AND public.has_member_permission(p.user_id,'inbox','view') AND public.has_member_permission(p.user_id,'inbox','send')
    ORDER BY CASE mp.status WHEN 'online' THEN 0 ELSE 1 END,
      (SELECT count(*) FROM public.conversations c WHERE c.assigned_agent_id=p.user_id AND c.status<>'closed'),p.user_id LIMIT 1;
  END IF;
  UPDATE public.conversations SET assigned_agent_id=chosen,ai_handoff_area=area_key,updated_at=now() WHERE id=conv.id;
  IF chosen IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.profiles WHERE user_id=conv.assigned_agent_id AND account_id=p_account AND upper(btrim(area))=area_key) THEN
    SELECT coalesce(max(created_at),now()) INTO boundary FROM public.messages WHERE conversation_id=conv.id AND sender_type='customer';
    UPDATE crm_private.conversation_history_grants SET visible_from=boundary WHERE conversation_id=conv.id AND user_id=chosen;
  END IF;
  IF area_key='FIDELIZACION' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_account::text,0));
    DELETE FROM public.contact_tags ct USING public.tags t WHERE ct.tag_id=t.id AND ct.contact_id=conv.contact_id AND t.account_id=p_account AND t.name IN ('AREA VENTAS','PENDIENTE DE ASIGNACION VENTAS');
    SELECT id INTO label FROM public.tags WHERE account_id=p_account AND name='AREA FIDELIZACION' ORDER BY created_at LIMIT 1;
    IF label IS NULL THEN INSERT INTO public.tags(account_id,user_id,name,color,kind,audience) VALUES(p_account,conv.user_id,'AREA FIDELIZACION','#06b6d4','access','{"users":[],"areas":["FIDELIZACION"],"roles":[]}'::jsonb) RETURNING id INTO label; END IF;
    INSERT INTO public.contact_tags(contact_id,tag_id) VALUES(conv.contact_id,label) ON CONFLICT DO NOTHING;
    SELECT coalesce(max(created_at),now()) INTO boundary FROM public.messages WHERE conversation_id=conv.id AND sender_type='customer';
    INSERT INTO crm_private.conversation_history_grants(conversation_id,user_id,visible_from) SELECT conv.id,p.user_id,boundary FROM public.profiles p WHERE p.account_id=p_account AND upper(btrim(p.area))='FIDELIZACION' ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM public.contact_tags ct USING public.tags t WHERE ct.tag_id=t.id AND ct.contact_id=conv.contact_id AND t.account_id=p_account AND t.name='AREA FIDELIZACION';
  END IF;
  RETURN jsonb_build_object('agent_id',chosen,'area',area_key);
END $$;
