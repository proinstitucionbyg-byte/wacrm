CREATE TABLE public.inbox_command_runs (
  id uuid PRIMARY KEY, account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  automation_id uuid NOT NULL REFERENCES public.automations(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'started' CHECK(status IN ('started','launched','failed'))
);
ALTER TABLE public.inbox_command_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inbox_command_runs FROM anon,authenticated;
GRANT ALL ON public.inbox_command_runs TO service_role;
CREATE FUNCTION public.start_inbox_command(p_id uuid,p_conversation uuid,p_automation uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE conv public.conversations; inserted integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_member_permission(auth.uid(),'inbox','send')
    OR crm_private.inbox_visible_from(p_conversation) IS NULL THEN RAISE EXCEPTION 'Sin acceso' USING ERRCODE='42501'; END IF;
  SELECT * INTO conv FROM public.conversations WHERE id=p_conversation FOR NO KEY UPDATE;
  IF NOT EXISTS(SELECT 1 FROM public.automations WHERE id=p_automation AND account_id=conv.account_id AND is_active)
    THEN RAISE EXCEPTION 'Bloque no disponible'; END IF;
  INSERT INTO public.inbox_command_runs(id,account_id,conversation_id,automation_id,actor_id)
    VALUES(p_id,conv.account_id,conv.id,p_automation,auth.uid()) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS inserted=ROW_COUNT;
  IF inserted=0 THEN RETURN false; END IF;
  UPDATE public.conversations SET last_human_message_at=now() WHERE id=conv.id;
  UPDATE public.conversation_sales_routes SET last_agent_message_at=now(),last_agent_message_id=NULL,lease_expires_at=now()+interval '2 hours'
    WHERE conversation_id=conv.id AND state='assigned' AND agent_id=auth.uid() AND conv.assigned_agent_id=auth.uid() AND lease_expires_at>now();
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.start_inbox_command(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.start_inbox_command(uuid,uuid,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
