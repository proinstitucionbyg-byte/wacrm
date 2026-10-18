ALTER TABLE public.adviser_reminders ADD COLUMN created_by uuid REFERENCES auth.users(id) DEFAULT auth.uid();
DROP POLICY adviser_reminders_add ON public.adviser_reminders;
CREATE POLICY adviser_reminders_add ON public.adviser_reminders FOR INSERT TO authenticated WITH CHECK (
  created_by=auth.uid() AND public.is_account_member(account_id)
  AND EXISTS(SELECT 1 FROM public.profiles p WHERE p.user_id=adviser_reminders.user_id AND p.account_id=adviser_reminders.account_id)
  AND ((user_id=auth.uid() AND (conversation_id IS NULL OR EXISTS(SELECT 1 FROM public.conversations c WHERE c.id=conversation_id AND c.account_id=adviser_reminders.account_id)))
    OR (action_kind='notification' AND conversation_id IS NULL)));
DROP POLICY adviser_reminders_read ON public.adviser_reminders;
CREATE POLICY adviser_reminders_read ON public.adviser_reminders FOR SELECT TO authenticated USING (
  public.is_account_member(account_id) AND (user_id=auth.uid() OR created_by=auth.uid() OR public.is_account_member(account_id,'owner')));
ALTER TABLE public.notifications ADD COLUMN dismissed_at timestamptz;
ALTER TABLE public.notifications ADD COLUMN dismissed_by uuid REFERENCES auth.users(id);
DROP POLICY notifications_select ON public.notifications;
CREATE POLICY notifications_select ON public.notifications FOR SELECT TO authenticated USING(auth.uid()=user_id AND dismissed_at IS NULL);
INSERT INTO public.permission_definitions(module,action,label) VALUES('notifications','manage','Retirar notificaciones propias y del equipo') ON CONFLICT(module,action) DO NOTHING;
INSERT INTO public.role_permissions(role,permission_id,allowed) SELECT 'admin',id,true FROM public.permission_definitions WHERE module='notifications' AND action='manage' ON CONFLICT(role,permission_id) DO UPDATE SET allowed=true;
INSERT INTO public.member_permission_overrides(user_id,permission_id,allowed)
  SELECT p.user_id,d.id,true FROM public.profiles p CROSS JOIN public.permission_definitions d
  WHERE d.module='notifications' AND d.action='manage' AND (upper(coalesce(p.cargo,'')) LIKE 'COORDINADOR%' OR upper(coalesce(p.area,''))='ADMINISTRATIVA') ON CONFLICT(user_id,permission_id) DO UPDATE SET allowed=true;
CREATE FUNCTION public.can_manage_team_notices() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT public.has_member_permission(auth.uid(),'notifications','manage');
$$;
REVOKE ALL ON FUNCTION public.can_manage_team_notices() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_manage_team_notices() TO authenticated;
CREATE FUNCTION public.dismiss_notification(p_id uuid,p_everyone boolean DEFAULT false) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n public.notifications; account_uuid uuid; total integer;
BEGIN
  SELECT account_id INTO account_uuid FROM public.profiles WHERE user_id=auth.uid();
  IF account_uuid IS NULL OR NOT public.can_manage_team_notices() THEN RAISE EXCEPTION 'Solo CEO, administracion o coordinadores' USING ERRCODE='42501'; END IF;
  SELECT * INTO n FROM public.notifications WHERE id=p_id AND account_id=account_uuid;
  IF n.id IS NULL THEN RAISE EXCEPTION 'Aviso no encontrado'; END IF;
  IF NOT p_everyone AND n.user_id<>auth.uid() THEN RAISE EXCEPTION 'No es tu aviso' USING ERRCODE='42501'; END IF;
  UPDATE public.notifications SET dismissed_at=now(),dismissed_by=auth.uid()
    WHERE account_id=account_uuid AND (id=n.id OR (p_everyone AND n.dedup_key IS NOT NULL AND dedup_key=n.dedup_key));
  GET DIAGNOSTICS total=ROW_COUNT;RETURN total;
END $$;
REVOKE ALL ON FUNCTION public.dismiss_notification(uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.dismiss_notification(uuid,boolean) TO authenticated;
DO $$ DECLARE definition text; BEGIN
  definition=pg_get_functiondef('public.apply_member_preset(uuid,text)'::regprocedure);
  definition=replace(definition,'(module=''notifications'' and action=''view'')','(module=''notifications'' and (action=''view'' or (action=''manage'' and p_preset in (''coordinador'',''coordinador_docentes'',''administrador''))))');
  EXECUTE definition;
END $$;
