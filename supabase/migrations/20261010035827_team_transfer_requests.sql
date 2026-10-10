CREATE TABLE public.team_transfer_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  thread_id uuid NOT NULL REFERENCES public.team_threads(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id), recipient_id uuid NOT NULL REFERENCES auth.users(id),
  assigned_snapshot uuid, full_history boolean NOT NULL, contact_label text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected','stale')),
  created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz
);
CREATE UNIQUE INDEX team_transfer_one_pending ON public.team_transfer_requests(conversation_id) WHERE status='pending';
ALTER TABLE public.team_transfer_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.team_transfer_requests FROM anon,authenticated;
GRANT SELECT ON public.team_transfer_requests TO authenticated;
GRANT ALL ON public.team_transfer_requests TO service_role;
CREATE POLICY team_transfer_read ON public.team_transfer_requests FOR SELECT TO authenticated USING (
  EXISTS(SELECT 1 FROM public.profiles p WHERE p.user_id=auth.uid() AND p.account_id=team_transfer_requests.account_id
    AND (p.user_id IN (sender_id,recipient_id) OR p.account_role IN ('owner','admin')))
);
CREATE FUNCTION public.request_team_transfer(p_thread uuid,p_conversation uuid,p_recipient uuid,p_full_history boolean) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor record; conv record; recipient record; result uuid; label text;
BEGIN
  SELECT * INTO actor FROM public.profiles WHERE user_id=auth.uid();
  IF actor.user_id IS NULL OR NOT public.has_member_permission(auth.uid(),'inbox','assign') OR p_full_history IS NULL
    OR crm_private.inbox_visible_from(p_conversation) IS NULL THEN RAISE EXCEPTION 'Sin permiso para derivar' USING ERRCODE='42501'; END IF;
  SELECT * INTO conv FROM public.conversations WHERE id=p_conversation AND account_id=actor.account_id FOR NO KEY UPDATE;
  IF NOT FOUND OR (conv.assigned_agent_id IS DISTINCT FROM auth.uid() AND actor.account_role NOT IN ('owner','admin') AND NOT public.has_member_permission(auth.uid(),'inbox','supervise')) THEN RAISE EXCEPTION 'El chat no esta a tu cargo' USING ERRCODE='42501'; END IF;
  IF p_full_history AND crm_private.inbox_visible_from(p_conversation)<>'-infinity'::timestamptz THEN RAISE EXCEPTION 'No puedes compartir historial que no puedes ver' USING ERRCODE='42501'; END IF;
  SELECT * INTO recipient FROM public.profiles WHERE user_id=p_recipient AND account_id=actor.account_id AND user_id<>auth.uid();
  IF NOT FOUND OR NOT public.has_member_permission(p_recipient,'inbox','view') OR NOT public.has_member_permission(p_recipient,'inbox','send') THEN RAISE EXCEPTION 'Destinatario sin acceso' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.team_threads t WHERE t.id=p_thread AND t.account_id=actor.account_id AND t.archived_at IS NULL
    AND EXISTS(SELECT 1 FROM public.team_thread_members m WHERE m.thread_id=t.id AND m.user_id=auth.uid() AND m.archived_at IS NULL)
    AND EXISTS(SELECT 1 FROM public.team_thread_members m WHERE m.thread_id=t.id AND m.user_id=p_recipient AND m.archived_at IS NULL)) THEN RAISE EXCEPTION 'Selecciona un chat interno compartido' USING ERRCODE='42501'; END IF;
  SELECT coalesce(nullif(c.name,''),'SIN NOMBRE')||' - '||coalesce(c.phone,'') INTO label FROM public.contacts c WHERE c.id=conv.contact_id AND c.account_id=actor.account_id;
  INSERT INTO public.team_transfer_requests(account_id,thread_id,conversation_id,sender_id,recipient_id,assigned_snapshot,full_history,contact_label)
    VALUES(actor.account_id,p_thread,conv.id,auth.uid(),p_recipient,conv.assigned_agent_id,p_full_history,coalesce(label,'CHAT')) RETURNING id INTO result;
  INSERT INTO public.team_messages(id,thread_id,account_id,sender_id,body) VALUES(gen_random_uuid(),p_thread,actor.account_id,auth.uid(),
    'SOLICITUD DE DERIVACION: '||coalesce(label,'CHAT')||E'\nPARA: '||coalesce(nullif(recipient.nickname,''),recipient.full_name,'ASESORA')||E'\nHISTORIAL: '||CASE WHEN p_full_history THEN 'COMPLETO' ELSE 'VACIO DESDE LA ACEPTACION' END||E'\nACEPTA LA SOLICITUD PARA RECIBIR EL CHAT.');
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.request_team_transfer(uuid,uuid,uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.request_team_transfer(uuid,uuid,uuid,boolean) TO authenticated;
CREATE FUNCTION public.resolve_team_transfer(p_request uuid,p_accept boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r record; conv record; receiver record; sender record; boundary timestamptz;
BEGIN
  IF auth.uid() IS NULL OR p_accept IS NULL THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
  SELECT * INTO r FROM public.team_transfer_requests WHERE id=p_request AND recipient_id=auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Solicitud no disponible' USING ERRCODE='42501'; END IF;
  IF r.status<>'pending' THEN RETURN jsonb_build_object('status',r.status,'conversation_id',r.conversation_id); END IF;
  SELECT * INTO receiver FROM public.profiles WHERE user_id=auth.uid() AND account_id=r.account_id;
  SELECT * INTO sender FROM public.profiles WHERE user_id=r.sender_id AND account_id=r.account_id;
  IF receiver.user_id IS NULL OR NOT public.has_member_permission(auth.uid(),'inbox','send') OR NOT public.has_member_permission(auth.uid(),'inbox','view')
    OR NOT public.has_member_permission(r.sender_id,'inbox','assign') OR NOT EXISTS(SELECT 1 FROM public.team_threads t WHERE t.id=r.thread_id AND t.archived_at IS NULL
    AND EXISTS(SELECT 1 FROM public.team_thread_members m WHERE m.thread_id=t.id AND m.user_id=auth.uid() AND m.archived_at IS NULL)
    AND EXISTS(SELECT 1 FROM public.team_thread_members m WHERE m.thread_id=t.id AND m.user_id=r.sender_id AND m.archived_at IS NULL)) THEN RAISE EXCEPTION 'Permisos de la solicitud cambiaron' USING ERRCODE='42501'; END IF;
  SELECT * INTO conv FROM public.conversations WHERE id=r.conversation_id AND account_id=r.account_id FOR NO KEY UPDATE;
  IF NOT FOUND OR conv.assigned_agent_id IS DISTINCT FROM r.assigned_snapshot THEN
    UPDATE public.team_transfer_requests SET status='stale',resolved_at=now() WHERE id=r.id;
    RETURN jsonb_build_object('status','stale');
  END IF;
  IF p_accept THEN
    PERFORM set_config('crm.transfer_authorized','1',true);
    PERFORM set_config('crm.accept_transfer_request',r.id::text,true);
    UPDATE public.conversations SET assigned_agent_id=auth.uid(),updated_at=now() WHERE id=conv.id;
    PERFORM set_config('crm.accept_transfer_request','',true);
    PERFORM set_config('crm.transfer_authorized','0',true);
    boundary=CASE WHEN r.full_history THEN '-infinity'::timestamptz ELSE clock_timestamp() END;
    INSERT INTO crm_private.conversation_history_grants(conversation_id,user_id,visible_from) VALUES(conv.id,auth.uid(),boundary)
      ON CONFLICT(conversation_id,user_id) DO UPDATE SET visible_from=EXCLUDED.visible_from;
  END IF;
  UPDATE public.team_transfer_requests SET status=CASE WHEN p_accept THEN 'accepted' ELSE 'rejected' END,resolved_at=now() WHERE id=r.id;
  INSERT INTO public.team_messages(id,thread_id,account_id,sender_id,body) VALUES(gen_random_uuid(),r.thread_id,r.account_id,auth.uid(),
    CASE WHEN p_accept THEN 'DERIVACION ACEPTADA: ' ELSE 'DERIVACION RECHAZADA: ' END||r.contact_label);
  RETURN jsonb_build_object('status',CASE WHEN p_accept THEN 'accepted' ELSE 'rejected' END,'conversation_id',conv.id);
END $$;
REVOKE ALL ON FUNCTION public.resolve_team_transfer(uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.resolve_team_transfer(uuid,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION crm_private.guard_inbox_assignment() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE accepted_request boolean;
BEGIN
  IF NEW.assigned_agent_id IS DISTINCT FROM OLD.assigned_agent_id THEN
    accepted_request=EXISTS(SELECT 1 FROM public.team_transfer_requests r WHERE r.id::text=current_setting('crm.accept_transfer_request',true)
      AND r.conversation_id=OLD.id AND r.account_id=OLD.account_id AND r.recipient_id=auth.uid() AND r.recipient_id=NEW.assigned_agent_id
      AND r.status='pending' AND r.assigned_snapshot IS NOT DISTINCT FROM OLD.assigned_agent_id
      AND public.has_member_permission(auth.uid(),'inbox','view') AND public.has_member_permission(auth.uid(),'inbox','send'));
    IF auth.uid() IS NOT NULL AND (current_setting('crm.transfer_authorized',true) IS DISTINCT FROM '1' OR
      (NOT public.has_member_permission(auth.uid(),'inbox','assign') AND NOT accepted_request)) THEN
      RAISE EXCEPTION 'Utiliza el traspaso de conversaciones' USING ERRCODE='42501';
    END IF;
    IF NEW.assigned_agent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.profiles WHERE user_id=NEW.assigned_agent_id AND account_id=NEW.account_id) THEN RAISE EXCEPTION 'Destinatario de otra cuenta' USING ERRCODE='42501'; END IF;
  END IF;
  RETURN NEW;
END $$;
