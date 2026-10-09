CREATE TABLE public.team_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK(kind IN ('direct','group')), title text CHECK(length(title)<=120), direct_key text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(), last_message_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,account_id), CHECK((kind='direct' AND direct_key IS NOT NULL) OR (kind='group' AND direct_key IS NULL AND length(trim(title))>0))
);
CREATE UNIQUE INDEX team_direct_unique ON public.team_threads(account_id,direct_key) WHERE kind='direct';
CREATE TABLE public.team_thread_members (
  thread_id uuid NOT NULL, account_id uuid NOT NULL, user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  last_read_at timestamptz, PRIMARY KEY(thread_id,user_id), FOREIGN KEY(thread_id,account_id) REFERENCES public.team_threads(id,account_id) ON DELETE CASCADE
);
CREATE INDEX team_members_user ON public.team_thread_members(user_id,thread_id);
CREATE TABLE public.team_messages (
  id uuid PRIMARY KEY, thread_id uuid NOT NULL, account_id uuid NOT NULL,
  sender_id uuid REFERENCES auth.users(id) ON DELETE SET NULL, body text NOT NULL CHECK(length(trim(body)) BETWEEN 1 AND 4000), created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(thread_id,account_id) REFERENCES public.team_threads(id,account_id) ON DELETE CASCADE
);
CREATE INDEX team_messages_thread ON public.team_messages(thread_id,created_at,id);
ALTER TABLE public.team_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_thread_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.team_threads,public.team_thread_members,public.team_messages FROM anon,authenticated;
GRANT SELECT ON public.team_threads,public.team_thread_members,public.team_messages TO authenticated;
GRANT INSERT(id,thread_id,account_id,sender_id,body) ON public.team_messages TO authenticated;
GRANT UPDATE(last_read_at) ON public.team_thread_members TO authenticated;
GRANT ALL ON public.team_threads,public.team_thread_members,public.team_messages TO service_role;

CREATE FUNCTION crm_private.team_access(target_thread uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS(SELECT 1 FROM public.team_thread_members m JOIN public.profiles p ON p.user_id=m.user_id AND p.account_id=m.account_id WHERE m.thread_id=target_thread AND m.user_id=auth.uid() AND p.account_role IN ('owner','admin','agent'))
$$;
REVOKE ALL ON FUNCTION crm_private.team_access(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION crm_private.team_access(uuid) TO authenticated;
CREATE POLICY team_threads_read ON public.team_threads FOR SELECT TO authenticated USING(crm_private.team_access(id));
CREATE POLICY team_members_read ON public.team_thread_members FOR SELECT TO authenticated USING(crm_private.team_access(thread_id));
CREATE POLICY team_members_read_at ON public.team_thread_members FOR UPDATE TO authenticated USING(user_id=auth.uid() AND crm_private.team_access(thread_id)) WITH CHECK(user_id=auth.uid() AND crm_private.team_access(thread_id));
CREATE POLICY team_messages_read ON public.team_messages FOR SELECT TO authenticated USING(crm_private.team_access(thread_id));
CREATE POLICY team_messages_send ON public.team_messages FOR INSERT TO authenticated WITH CHECK(sender_id=auth.uid() AND crm_private.team_access(thread_id));

CREATE FUNCTION crm_private.create_team_thread(target_members uuid[],thread_title text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid=auth.uid(); account uuid; members uuid[]; n integer; room uuid; room_kind text; pair text;
BEGIN
  SELECT p.account_id INTO account FROM public.profiles p WHERE p.user_id=uid AND p.account_role IN ('owner','admin','agent');
  IF account IS NULL THEN RAISE EXCEPTION 'Acceso denegado' USING ERRCODE='42501'; END IF;
  IF coalesce(cardinality(target_members),0)>20 THEN RAISE EXCEPTION 'Demasiados participantes'; END IF;
  SELECT array_agg(x ORDER BY x) INTO members FROM (SELECT DISTINCT unnest(array_append(target_members,uid)) AS x) a WHERE x IS NOT NULL;
  n=cardinality(members);
  IF n<2 OR n>20 THEN RAISE EXCEPTION 'Selecciona de 2 a 20 participantes'; END IF;
  IF (SELECT count(*) FROM public.profiles p WHERE p.user_id=ANY(members) AND p.account_id=account AND p.account_role IN ('owner','admin','agent'))<>n THEN RAISE EXCEPTION 'Participantes de otra cuenta o sin acceso' USING ERRCODE='42501'; END IF;
  room_kind=CASE WHEN n=2 AND nullif(trim(thread_title),'') IS NULL THEN 'direct' ELSE 'group' END;
  IF room_kind='group' AND (nullif(trim(thread_title),'') IS NULL OR length(trim(thread_title))>120) THEN RAISE EXCEPTION 'Nombre de grupo invalido'; END IF;
  pair=CASE WHEN room_kind='direct' THEN array_to_string(members,':') ELSE NULL END;
  IF room_kind='direct' THEN
    INSERT INTO public.team_threads(account_id,kind,direct_key,created_by) VALUES(account,'direct',pair,uid)
      ON CONFLICT(account_id,direct_key) WHERE kind='direct' DO UPDATE SET direct_key=EXCLUDED.direct_key RETURNING id INTO room;
  ELSE
    INSERT INTO public.team_threads(account_id,kind,title,created_by) VALUES(account,'group',trim(thread_title),uid) RETURNING id INTO room;
  END IF;
  INSERT INTO public.team_thread_members(thread_id,account_id,user_id) SELECT room,account,unnest(members) ON CONFLICT DO NOTHING;
  RETURN room;
END $$;
REVOKE ALL ON FUNCTION crm_private.create_team_thread(uuid[],text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION crm_private.create_team_thread(uuid[],text) TO authenticated;
CREATE FUNCTION public.create_team_thread(target_members uuid[],thread_title text DEFAULT NULL) RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT crm_private.create_team_thread(target_members,thread_title) $$;
REVOKE ALL ON FUNCTION public.create_team_thread(uuid[],text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_team_thread(uuid[],text) TO authenticated;

ALTER TABLE public.notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK(type IN ('conversation_assigned','team_message'));
ALTER TABLE public.notifications ADD COLUMN team_thread_id uuid REFERENCES public.team_threads(id) ON DELETE CASCADE;
CREATE FUNCTION crm_private.notify_team_message() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor text;
BEGIN
  UPDATE public.team_threads SET last_message_at=NEW.created_at WHERE id=NEW.thread_id AND account_id=NEW.account_id;
  SELECT coalesce(nullif(p.full_name,''),'Equipo') INTO actor FROM public.profiles p WHERE p.user_id=NEW.sender_id AND p.account_id=NEW.account_id;
  INSERT INTO public.notifications(account_id,user_id,type,actor_user_id,title,body,team_thread_id)
    SELECT NEW.account_id,m.user_id,'team_message',NEW.sender_id,'MENSAJE INTERNO','Nuevo mensaje de '||coalesce(actor,'Equipo'),NEW.thread_id
    FROM public.team_thread_members m JOIN public.profiles p ON p.user_id=m.user_id AND p.account_id=m.account_id
    WHERE m.thread_id=NEW.thread_id AND m.user_id<>NEW.sender_id AND p.account_role IN ('owner','admin','agent');
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION crm_private.notify_team_message() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER notify_team_message AFTER INSERT ON public.team_messages FOR EACH ROW EXECUTE FUNCTION crm_private.notify_team_message();
NOTIFY pgrst,'reload schema';
