-- Add an independent exceptional queue; existing completed enrollment blocks stay intact.
ALTER TABLE public.enrollment_sequence_runs DROP CONSTRAINT enrollment_sequence_runs_stage_check;
ALTER TABLE public.enrollment_sequence_runs ADD CONSTRAINT enrollment_sequence_runs_stage_check
 CHECK(stage IN ('receipt','final','provisional','intake_followup','intake_lastcall'));
ALTER TABLE public.enrollment_sequence_runs DROP CONSTRAINT enrollment_sequence_runs_status_check;
ALTER TABLE public.enrollment_sequence_runs ADD CONSTRAINT enrollment_sequence_runs_status_check CHECK(status IN ('running','started','review','closed'));
CREATE TABLE public.incomplete_intake_watches (
 enrollment_id uuid PRIMARY KEY REFERENCES public.enrollment_drafts(id) ON DELETE CASCADE,
 account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
 conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
 welcome_due_at timestamptz NOT NULL,
 checked_at timestamptz NOT NULL DEFAULT now(),closed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.incomplete_intake_watches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.incomplete_intake_watches FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.incomplete_intake_watches TO service_role;
GRANT SELECT ON public.incomplete_intake_watches TO authenticated;
CREATE POLICY incomplete_intake_visible ON public.incomplete_intake_watches FOR SELECT TO authenticated
 USING(crm_private.inbox_visible_from(conversation_id) IS NOT NULL AND EXISTS(SELECT 1 FROM public.profiles p WHERE p.user_id=auth.uid() AND p.account_id=incomplete_intake_watches.account_id));
CREATE INDEX incomplete_intake_pending ON public.incomplete_intake_watches(checked_at) WHERE closed_at IS NULL;

CREATE FUNCTION crm_private.watch_incomplete_intake() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE reviewed timestamptz;
BEGIN
 SELECT reviewed_at INTO reviewed FROM public.payment_reviews WHERE id=NEW.review_id AND account_id=NEW.account_id AND status='validated';
 IF reviewed IS NOT NULL AND NEW.conversation_id IS NOT NULL THEN
  INSERT INTO public.incomplete_intake_watches(enrollment_id,account_id,conversation_id,welcome_due_at)
   VALUES(NEW.id,NEW.account_id,NEW.conversation_id,reviewed+interval '2 hours') ON CONFLICT DO NOTHING;
 END IF;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION crm_private.watch_incomplete_intake() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER watch_incomplete_intake AFTER INSERT ON public.enrollment_drafts FOR EACH ROW EXECUTE FUNCTION crm_private.watch_incomplete_intake();
INSERT INTO public.incomplete_intake_watches(enrollment_id,account_id,conversation_id,welcome_due_at)
 SELECT e.id,e.account_id,e.conversation_id,r.reviewed_at+interval '2 hours' FROM public.enrollment_drafts e JOIN public.payment_reviews r ON r.id=e.review_id AND r.account_id=e.account_id
 WHERE e.status='collecting' AND e.conversation_id IS NOT NULL AND r.status='validated' AND r.reviewed_at>now()-interval '24 hours' ON CONFLICT DO NOTHING;
CREATE FUNCTION crm_private.close_incomplete_intake() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.status<>'collecting' THEN
  UPDATE public.incomplete_intake_watches SET closed_at=now() WHERE enrollment_id=NEW.id AND closed_at IS NULL;
  UPDATE public.notifications SET expires_at=now() WHERE account_id=NEW.account_id AND dedup_key IN ('incomplete:'||NEW.id::text,'incomplete-window:'||NEW.id::text);
  UPDATE public.enrollment_sequence_runs SET status='closed' WHERE account_id=NEW.account_id AND source_id=NEW.id AND stage='provisional' AND status='started' AND completed_at IS NULL AND backup_sent_at IS NULL;
 END IF;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION crm_private.close_incomplete_intake() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER close_incomplete_intake AFTER UPDATE OF status ON public.enrollment_drafts FOR EACH ROW EXECUTE FUNCTION crm_private.close_incomplete_intake();
CREATE FUNCTION public.has_completed_intake_welcome(p_account uuid,p_enrollment uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.enrollment_sequence_runs WHERE account_id=p_account AND source_id=p_enrollment AND stage='provisional' AND (completed_by IS NOT NULL OR backup_sent_at IS NOT NULL));
$$;
REVOKE ALL ON FUNCTION public.has_completed_intake_welcome(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.has_completed_intake_welcome(uuid,uuid) TO service_role;

-- No historical students are messaged by this migration. New validations enter the queue.
DO $$ DECLARE definition text; BEGIN
 definition=pg_get_functiondef('public.complete_enrollment_welcome(uuid)'::regprocedure);
 IF position('stage=''final''' in definition)=0 THEN RAISE EXCEPTION 'Unexpected welcome check'; END IF;
 definition=replace(definition,'stage=''final''','stage IN (''final'',''provisional'')');
 definition=replace(definition,'RETURN jsonb_build_object(''completed_at'',clock_timestamp());',
 'IF r.stage=''provisional'' THEN UPDATE public.enrollment_sequence_runs SET completed_at=clock_timestamp(),completed_by=auth.uid() WHERE account_id=r.account_id AND source_id=r.source_id AND stage=''final'' AND completed_at IS NULL AND backup_sent_at IS NULL; END IF;
  RETURN jsonb_build_object(''completed_at'',clock_timestamp());');
 EXECUTE definition;
END $$;

-- Use the already configured general image and requirements audio. Do not
-- reuse a billing-day audio when the incomplete intake has no verified start.
DO $$ DECLARE owner_row record; receipt record; final_block record; image_config jsonb; audio_config jsonb; created_id uuid; event_name text; title text; image_count integer; audio_count integer;
BEGIN
 FOR owner_row IN SELECT id,owner_user_id FROM public.accounts LOOP
  SELECT * INTO receipt FROM public.automations WHERE account_id=owner_row.id AND is_active AND trigger_config->>'internal_event'='receipt_received' LIMIT 1;
  SELECT * INTO final_block FROM public.automations WHERE account_id=owner_row.id AND is_active AND trigger_config->>'internal_event'='documents_sent' ORDER BY created_at LIMIT 1;
  IF receipt.id IS NULL OR final_block.id IS NULL THEN CONTINUE; END IF;
  SELECT count(*) INTO image_count FROM public.automation_steps WHERE automation_id=final_block.id AND parent_step_id IS NULL AND step_type='send_media' AND step_config->>'media_type'='image';
  SELECT count(*) INTO audio_count FROM public.automation_steps WHERE automation_id=receipt.id AND parent_step_id IS NULL AND step_type='send_media' AND step_config->>'media_type'='audio';
  IF image_count<>1 OR audio_count<>1 THEN RAISE EXCEPTION 'Configure one general welcome image and one requirements audio'; END IF;
  SELECT step_config INTO image_config FROM public.automation_steps WHERE automation_id=final_block.id AND parent_step_id IS NULL AND step_type='send_media' AND step_config->>'media_type'='image';
  SELECT step_config INTO audio_config FROM public.automation_steps WHERE automation_id=receipt.id AND parent_step_id IS NULL AND step_type='send_media' AND step_config->>'media_type'='audio';
  FOREACH event_name IN ARRAY ARRAY['provisional','intake_followup','intake_lastcall'] LOOP
   IF EXISTS(SELECT 1 FROM public.automations WHERE account_id=owner_row.id AND trigger_config->>'internal_event'=event_name) THEN CONTINUE; END IF;
   title=CASE event_name WHEN 'provisional' THEN 'BIENVENIDA · DATOS PENDIENTES' WHEN 'intake_followup' THEN 'SEGUIMIENTO · DATOS PENDIENTES' ELSE 'ANTES DEL CIERRE · DATOS PENDIENTES' END;
   INSERT INTO public.automations(account_id,user_id,name,description,trigger_type,trigger_config,is_active,folder_id)
    VALUES(owner_row.id,owner_row.owner_user_id,title,'Secuencia interna de pago validado y registro incompleto. No se activa con un saludo.','new_message',jsonb_build_object('internal_only',true,'internal_event',event_name),true,final_block.folder_id) RETURNING id INTO created_id;
   INSERT INTO public.automation_steps(automation_id,step_type,step_config,position) VALUES(created_id,'send_message',jsonb_build_object('text','{{message.text}}'),0);
   IF event_name='provisional' THEN
    INSERT INTO public.automation_steps(automation_id,step_type,step_config,position) VALUES(created_id,'send_media',image_config,1),(created_id,'send_media',audio_config,2);
   END IF;
  END LOOP;
 END LOOP;
END $$;
