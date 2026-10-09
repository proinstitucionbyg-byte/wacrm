CREATE TABLE public.academic_calendar_snapshots (
  account_id uuid PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  source_url text NOT NULL,
  modules jsonb NOT NULL CHECK(jsonb_typeof(modules)='array'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.academic_calendar_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.academic_calendar_snapshots FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.academic_calendar_snapshots TO authenticated;
GRANT ALL ON public.academic_calendar_snapshots TO service_role;
CREATE POLICY academic_calendar_read ON public.academic_calendar_snapshots FOR SELECT TO authenticated USING (
  EXISTS(SELECT 1 FROM public.profiles p WHERE p.user_id=auth.uid() AND p.account_id=academic_calendar_snapshots.account_id)
  AND public.has_member_permission(auth.uid(),'inbox','view')
);

ALTER TABLE public.team_messages ADD COLUMN attachment_path text, ADD COLUMN attachment_name text;
GRANT INSERT(attachment_path,attachment_name) ON public.team_messages TO authenticated;
ALTER TABLE public.team_messages ADD CONSTRAINT team_attachment_pair CHECK((attachment_path IS NULL AND attachment_name IS NULL) OR
  (attachment_path IS NOT NULL AND attachment_name IS NOT NULL AND attachment_path LIKE 'account-'||account_id::text||'/'||thread_id::text||'/%' AND length(attachment_name) BETWEEN 1 AND 180));
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES('team-chat-media','team-chat-media',false,16777216,
  ARRAY['image/jpeg','image/png','image/webp','application/pdf','text/plain','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation','audio/ogg','audio/mpeg','video/mp4']);
CREATE FUNCTION crm_private.team_attachment_access(path text,writing boolean) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE room uuid; account uuid;
BEGIN
  IF path !~ '^account-[0-9a-f-]{36}/[0-9a-f-]{36}/[^/]+$' THEN RETURN false; END IF;
  account=substring(split_part(path,'/',1) from 9)::uuid; room=split_part(path,'/',2)::uuid;
  IF NOT EXISTS(SELECT 1 FROM public.team_threads t WHERE t.id=room AND t.account_id=account) OR NOT crm_private.team_access(room) THEN RETURN false; END IF;
  IF writing THEN RETURN EXISTS(SELECT 1 FROM public.team_thread_members m JOIN public.team_threads t ON t.id=m.thread_id WHERE m.thread_id=room AND m.user_id=auth.uid() AND t.archived_at IS NULL); END IF;
  RETURN true;
EXCEPTION WHEN invalid_text_representation THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION crm_private.team_attachment_access(text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION crm_private.team_attachment_access(text,boolean) TO authenticated;
CREATE POLICY team_files_read ON storage.objects FOR SELECT TO authenticated USING(bucket_id='team-chat-media' AND crm_private.team_attachment_access(name,false));
CREATE POLICY team_files_add ON storage.objects FOR INSERT TO authenticated WITH CHECK(bucket_id='team-chat-media' AND crm_private.team_attachment_access(name,true));
CREATE POLICY team_files_remove ON storage.objects FOR DELETE TO authenticated USING(bucket_id='team-chat-media' AND owner_id=auth.uid()::text AND crm_private.team_attachment_access(name,true));

ALTER TABLE public.notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK(type IN ('conversation_assigned','team_message','system_notice'));
ALTER TABLE public.notifications ADD COLUMN target_url text, ADD COLUMN dedup_key text;
CREATE UNIQUE INDEX notification_dedup ON public.notifications(account_id,user_id,dedup_key);

CREATE FUNCTION public.sync_academic_calendar(p_account uuid,p_modules jsonb,p_source text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE previous jsonb; changed text; notice_key text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('calendar:'||p_account::text,0));
  SELECT modules INTO previous FROM public.academic_calendar_snapshots WHERE account_id=p_account;
  IF previous IS NOT NULL AND previous<>p_modules THEN
    SELECT string_agg((r->>'course')||': '||(r->>'module')||' — '||(r->>'start_date'),E'\n') INTO changed FROM jsonb_array_elements(p_modules) r WHERE NOT previous @> jsonb_build_array(r);
    notice_key='calendar:'||md5(previous::text||p_modules::text);
    INSERT INTO public.notifications(account_id,user_id,type,title,body,target_url,dedup_key)
      SELECT p_account,p.user_id,'system_notice','REVISAR CAMBIO EN CUADRO DE INICIOS',coalesce(changed,'CAMBIO DE PROGRAMACION')||E'\nAVISAR A LOS GRUPOS, AL DOCENTE Y A LOS NUEVOS INGRESOS. REVISAR MATRICULAS Y CRONOGRAMAS.',p_source,notice_key
      FROM public.profiles p WHERE p.account_id=p_account AND (upper(btrim(p.area))='FIDELIZACION' OR p.account_role IN ('owner','admin')) ON CONFLICT DO NOTHING;
  END IF;
  INSERT INTO public.academic_calendar_snapshots(account_id,modules,source_url,updated_at) VALUES(p_account,p_modules,p_source,now())
    ON CONFLICT(account_id) DO UPDATE SET modules=EXCLUDED.modules,source_url=EXCLUDED.source_url,updated_at=EXCLUDED.updated_at;
END $$;
REVOKE ALL ON FUNCTION public.sync_academic_calendar(uuid,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sync_academic_calendar(uuid,jsonb,text) TO service_role;
