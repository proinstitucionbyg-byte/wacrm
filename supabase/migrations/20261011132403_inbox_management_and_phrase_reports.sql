-- Additive changes; no messages, vouchers or enrollment records are erased.
ALTER TABLE public.conversations ADD COLUMN inbox_cleared_at timestamptz;
INSERT INTO public.permission_definitions(module,action,label,description) VALUES
 ('inbox_management','conversations','Eliminar y recuperar chats del Inbox','Solo CEO por defecto; el CEO puede delegarlo explícitamente. No elimina archivos académicos.'),
 ('inbox_management','messages','Ocultar mensajes para mí','Solo CEO por defecto; el CEO puede delegarlo explícitamente. No retira mensajes del teléfono del destinatario.')
ON CONFLICT(module,action) DO NOTHING;

-- Preserve all current permissions. These two new actions are exceptions to
-- the legacy blanket administrator grant: only the owner can delegate them.
DO $$ DECLARE definition text; BEGIN
 definition=pg_get_functiondef('public.has_member_permission(uuid,text,text)'::regprocedure);
 IF position('IF v_role IN (''owner'', ''admin'') THEN' in definition)=0 THEN RAISE EXCEPTION 'Unexpected permission implementation'; END IF;
 definition=replace(definition,'IF v_role IN (''owner'', ''admin'') THEN',
 'IF p_module = ''inbox_management'' THEN
    IF v_role = ''owner'' THEN RETURN TRUE; END IF;
    RETURN COALESCE((SELECT o.allowed FROM public.member_permission_overrides o JOIN public.permission_definitions d ON d.id=o.permission_id WHERE o.user_id=p_user_id AND d.module=p_module AND d.action=p_action),FALSE);
  END IF;
  IF v_role IN (''owner'', ''admin'') THEN');
 EXECUTE definition;
 definition=pg_get_functiondef('public.get_member_permissions(uuid)'::regprocedure);
 IF position('WHEN v_target_role IN (''owner'', ''admin'') THEN true' in definition)=0 THEN RAISE EXCEPTION 'Unexpected member permission implementation'; END IF;
 definition=replace(definition,'WHEN v_target_role IN (''owner'', ''admin'') THEN true','WHEN d.module=''inbox_management'' THEN public.has_member_permission(p_user_id,d.module,d.action) WHEN v_target_role IN (''owner'', ''admin'') THEN true');
 definition=replace(definition,'WHEN v_target_role IN (''owner'', ''admin'') THEN v_target_role::text','WHEN d.module=''inbox_management'' AND v_target_role<>''owner'' THEN ''override'' WHEN v_target_role IN (''owner'', ''admin'') THEN v_target_role::text');
 EXECUTE definition;
 definition=pg_get_functiondef('public.set_member_permission(uuid,text,text,boolean)'::regprocedure);
 IF position('SELECT account_id' in definition)=0 THEN RAISE EXCEPTION 'Unexpected delegation implementation'; END IF;
 definition=replace(definition,'IF v_target_account_id <> v_caller_account_id THEN','IF p_module=''inbox_management'' AND v_caller_role<>''owner'' THEN RAISE EXCEPTION ''Solo el CEO puede delegar este permiso'' USING ERRCODE=''42501''; END IF;
  IF v_target_account_id <> v_caller_account_id THEN');
 EXECUTE definition;
END $$;

CREATE FUNCTION public.set_inbox_cleared(p_conversation uuid,p_clear boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR p_clear IS NULL OR NOT public.has_member_permission(auth.uid(),'inbox_management','conversations')
 OR crm_private.inbox_visible_from(p_conversation) IS NULL
 OR NOT EXISTS(SELECT 1 FROM public.conversations c JOIN public.profiles p ON p.account_id=c.account_id WHERE c.id=p_conversation AND p.user_id=auth.uid())
 THEN RAISE EXCEPTION 'Sin permiso para eliminar o recuperar este chat' USING ERRCODE='42501'; END IF;
 UPDATE public.conversations SET inbox_cleared_at=CASE WHEN p_clear THEN now() ELSE NULL END WHERE id=p_conversation;
END $$;
REVOKE ALL ON FUNCTION public.set_inbox_cleared(uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_inbox_cleared(uuid,boolean) TO authenticated;

CREATE FUNCTION public.list_cleared_inbox() RETURNS TABLE(id uuid,name text,cleared_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT c.id,coalesce(ct.name,nullif(ct.phone,''),'SIN NOMBRE'),c.inbox_cleared_at FROM public.conversations c
 JOIN public.profiles p ON p.account_id=c.account_id AND p.user_id=auth.uid()
 LEFT JOIN public.contacts ct ON ct.id=c.contact_id
 WHERE auth.uid() IS NOT NULL AND public.has_member_permission(auth.uid(),'inbox_management','conversations') AND crm_private.inbox_visible_from(c.id) IS NOT NULL AND c.inbox_cleared_at IS NOT NULL
 ORDER BY c.inbox_cleared_at DESC;
$$;
REVOKE ALL ON FUNCTION public.list_cleared_inbox() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_cleared_inbox() TO authenticated;

-- Existing assignment/history boundaries remain in force, with an additional
-- cutoff for deleted history. A new message can reopen the same conversation.
DO $$ DECLARE definition text; BEGIN
 definition=pg_get_functiondef('crm_private.inbox_visible_from(uuid)'::regprocedure);
 IF position('RETURN ''-infinity'';' in definition)=0 THEN RAISE EXCEPTION 'Unexpected inbox visibility implementation'; END IF;
 definition=replace(definition,'RETURN ''-infinity'';','RETURN coalesce(conv.inbox_cleared_at,''-infinity''::timestamptz);');
 definition=replace(definition,'RETURN coalesce(boundary,''-infinity''::timestamptz);','RETURN greatest(coalesce(boundary,''-infinity''::timestamptz),coalesce(conv.inbox_cleared_at,''-infinity''::timestamptz));');
 EXECUTE definition;
END $$;

CREATE TABLE public.inbox_hidden_messages (
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(user_id,message_id)
);
ALTER TABLE public.inbox_hidden_messages ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,DELETE ON public.inbox_hidden_messages TO authenticated;
CREATE POLICY hidden_messages_read ON public.inbox_hidden_messages FOR SELECT TO authenticated USING(user_id=auth.uid());
CREATE POLICY hidden_messages_insert ON public.inbox_hidden_messages FOR INSERT TO authenticated WITH CHECK(
 user_id=auth.uid() AND public.has_member_permission(auth.uid(),'inbox_management','messages') AND EXISTS(SELECT 1 FROM public.messages m WHERE m.id=inbox_hidden_messages.message_id));
CREATE POLICY hidden_messages_restore ON public.inbox_hidden_messages FOR DELETE TO authenticated USING(user_id=auth.uid() AND public.has_member_permission(auth.uid(),'inbox_management','messages'));
-- Message hiding is applied only in the UI loader, so it cannot affect AI,
-- payment evidence or the transcript another team member is authorized to see.
CREATE FUNCTION public.restore_hidden_inbox_messages(p_conversation uuid) RETURNS void
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 DELETE FROM public.inbox_hidden_messages h USING public.messages m WHERE m.id=h.message_id AND m.conversation_id=p_conversation AND h.user_id=auth.uid();
$$;
REVOKE ALL ON FUNCTION public.restore_hidden_inbox_messages(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.restore_hidden_inbox_messages(uuid) TO authenticated;

CREATE TABLE public.first_text_reports (
 account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
 period_start timestamptz NOT NULL,period_end timestamptz NOT NULL,
 period_kind text NOT NULL CHECK(period_kind IN ('week','month')),
 phrases jsonb NOT NULL,words jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(account_id,period_kind,period_start)
);
ALTER TABLE public.first_text_reports ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.first_text_reports TO authenticated;
CREATE POLICY first_text_reports_ceo ON public.first_text_reports FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.profiles p WHERE p.user_id=auth.uid() AND p.account_id=first_text_reports.account_id AND p.account_role='owner'));

CREATE FUNCTION public.publish_first_text_reports(p_force boolean DEFAULT false) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE local_now timestamp=now() AT TIME ZONE 'America/Lima'; finish timestamptz; start_at timestamptz; end_at timestamptz; kind text; owner_row record; report_phrases jsonb; report_words jsonb; total integer=0; inserted integer;
BEGIN
 IF NOT p_force AND (extract(isodow FROM local_now)<>6 OR extract(hour FROM local_now)<7) THEN RETURN 0; END IF;
 finish=(date_trunc('week',local_now)+interval '5 days 7 hours') AT TIME ZONE 'America/Lima';
 IF finish>now() THEN finish=finish-interval '7 days'; END IF;
 FOR owner_row IN SELECT account_id,user_id FROM public.profiles WHERE account_role='owner' LOOP
  IF NOT p_force AND EXISTS(SELECT 1 FROM public.notifications WHERE user_id=owner_row.user_id AND account_id=owner_row.account_id AND dedup_key='first-text:'||(local_now::date)::text) THEN CONTINUE; END IF;
  FOREACH kind IN ARRAY ARRAY['week','month'] LOOP
   end_at=CASE WHEN kind='month' AND p_force THEN now() ELSE finish END;
   start_at=CASE WHEN kind='week' THEN finish-interval '7 days' ELSE date_trunc('month',end_at AT TIME ZONE 'America/Lima') AT TIME ZONE 'America/Lima' END;
   WITH first_text AS (
    SELECT DISTINCT ON (m.conversation_id,(m.sender_type='customer')) m.conversation_id,m.created_at,CASE WHEN m.sender_type='customer' THEN 'ENTRANTE' ELSE 'SALIENTE' END AS direction,
     lower(regexp_replace(btrim(m.content_text),'\s+',' ','g')) AS phrase
    FROM public.messages m JOIN public.conversations c ON c.id=m.conversation_id
    WHERE c.account_id=owner_row.account_id AND m.content_type IN ('text','interactive','template') AND nullif(btrim(m.content_text),'') IS NOT NULL
     AND (m.sender_type='customer' OR m.status IN ('sent','delivered','read'))
    ORDER BY m.conversation_id,(m.sender_type='customer'),m.created_at,m.id
   ), counts AS (SELECT direction,phrase,count(*) AS quantity FROM first_text WHERE created_at>=start_at AND created_at<end_at GROUP BY direction,phrase),
   word_counts AS (SELECT direction,coalesce(nullif(substring(phrase FROM '[[:alnum:]]+'),''),'SIN PALABRA') AS word,sum(quantity) AS quantity FROM counts GROUP BY direction,word)
   SELECT coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY quantity DESC,direction,phrase) FROM counts x),'[]'::jsonb),
    coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY quantity DESC,direction,word) FROM word_counts x),'[]'::jsonb) INTO report_phrases,report_words;
   INSERT INTO public.first_text_reports(account_id,period_start,period_end,period_kind,phrases,words)
    VALUES(owner_row.account_id,start_at,end_at,kind,report_phrases,report_words)
    ON CONFLICT(account_id,period_kind,period_start) DO UPDATE SET period_end=excluded.period_end,phrases=excluded.phrases,words=excluded.words,created_at=now();
  END LOOP;
  IF NOT p_force THEN
  INSERT INTO public.notifications(account_id,user_id,type,title,body,target_url,dedup_key)
   VALUES(owner_row.account_id,owner_row.user_id,'system_notice','ESTADÍSTICA SEMANAL · PRIMERAS FRASES',
    'Informe de los primeros textos recibidos y enviados por conversación. Imágenes y audios no se cuentan como texto inicial. Incluye acumulado del mes. Abre ESTADÍSTICAS para ver las frases y palabras completas.','/reports','first-text:'||(local_now::date)::text)
   ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS inserted=ROW_COUNT; total=total+inserted;
  END IF;
 END LOOP; RETURN total;
END $$;
REVOKE ALL ON FUNCTION public.publish_first_text_reports(boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.publish_first_text_reports(boolean) TO service_role;

-- Only the controlled soft deletion is available to browser clients. This
-- prevents a legacy direct DELETE from destroying payment message evidence.
DROP POLICY conversations_delete ON public.conversations;
DROP POLICY messages_delete ON public.messages;

-- The user's definition of weekly is Saturday early, also for the existing
-- team report. Preserve all the existing content and other start alerts.
DO $$ DECLARE definition text; BEGIN
 definition=pg_get_functiondef('public.publish_operational_notices()'::regprocedure);
 IF position('extract(isodow FROM today)<>5' in definition)=0 THEN RAISE EXCEPTION 'Unexpected weekly schedule'; END IF;
 definition=replace(definition,'extract(isodow FROM today)<>5','extract(isodow FROM today)<>6');
 definition=replace(definition,'America/Lima'')<22','America/Lima'')<7');
 definition=replace(definition,'interval ''22 hours''','interval ''7 hours''');
 EXECUTE definition;
END $$;
