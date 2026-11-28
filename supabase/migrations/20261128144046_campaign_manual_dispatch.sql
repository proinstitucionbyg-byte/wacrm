BEGIN;
ALTER TABLE public.multichannel_campaigns ADD COLUMN manual_batch_job_ids uuid[], ADD COLUMN manual_request_id uuid;

CREATE FUNCTION public.adjust_campaign_dispatch(p_account uuid,p_actor uuid,p_campaign uuid,p_request uuid,p_action text,p_lines text[],p_count integer,p_unit text,p_interval integer,p_block integer,p_pause integer,p_enable boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE c public.multichannel_campaigns;l public.multichannel_whatsapp_session_lines;ids uuid[];chosen_routes jsonb;n integer;people integer;tick timestamptz:=clock_timestamp();
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE account_id=p_account AND user_id=p_actor AND account_role='owner') THEN RAISE EXCEPTION 'Solo el propietario puede ajustar envíos';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_account::text,0));
 SELECT * INTO STRICT c FROM public.multichannel_campaigns WHERE account_id=p_account AND id=p_campaign FOR UPDATE;
 IF c.manual_request_id=p_request THEN RETURN jsonb_build_object('duplicate',true,'messages',cardinality(c.manual_batch_job_ids),'status',c.status);END IF;
 IF c.status<>'paused' THEN RAISE EXCEPTION 'Pausa la campaña antes de ajustar el envío';END IF;
 IF c.expires_at<=tick THEN RAISE EXCEPTION 'La campaña venció';END IF;
 IF p_request IS NULL OR p_action NOT IN('save','send') OR p_unit NOT IN('messages','recipients') OR p_count NOT BETWEEN 1 AND 1000 OR p_interval NOT BETWEEN 1 AND 86400 OR p_block NOT BETWEEN 1 AND 1000 OR p_pause NOT BETWEEN 0 AND 604800 OR coalesce(cardinality(p_lines),0) NOT BETWEEN 1 AND 10 OR cardinality(p_lines)<>(SELECT count(DISTINCT x) FROM unnest(p_lines) x) THEN RAISE EXCEPTION 'Ajustes inválidos';END IF;
 IF EXISTS(SELECT 1 FROM public.multichannel_jobs WHERE account_id=p_account AND campaign_id=c.id AND status IN('claimed','dispatching')) THEN RAISE EXCEPTION 'Hay mensajes en proceso; espera a que terminen y actualiza';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(c.routes) r JOIN public.multichannel_whatsapp_session_lines sl ON sl.account_id=p_account AND sl.line_key=r->>'line_key' WHERE sl.campaign_restricted) THEN RAISE EXCEPTION 'Hay una restricción de WhatsApp pendiente de revisión';END IF;
 -- Validate every explicitly chosen physical line.
  FOR l IN SELECT * FROM public.multichannel_whatsapp_session_lines WHERE account_id=p_account AND line_key=ANY(p_lines) FOR UPDATE LOOP
   IF l.campaign_restricted OR (l.paused AND NOT p_enable) OR NOT EXISTS(
    SELECT 1 FROM public.whatsapp_management_state s JOIN public.multichannel_workers w ON w.id=s.worker_id AND w.account_id=s.account_id AND w.enabled
    CROSS JOIN LATERAL jsonb_array_elements(s.snapshot) x
    WHERE s.account_id=p_account AND s.worker_id=l.worker_id AND s.seen_at>=tick-interval '20 seconds' AND s.seen_at<=tick
    AND x->>'lineKey'=l.line_key AND x->>'linkedPhone'=l.linked_phone AND x->>'status'='ready' AND x->>'active'='true' AND coalesce(x->>'archived','false')<>'true') THEN RAISE EXCEPTION 'Una línea elegida no está disponible o su bot está pausado';END IF;
  END LOOP;
 IF (SELECT count(*) FROM public.multichannel_whatsapp_session_lines WHERE account_id=p_account AND line_key=ANY(p_lines))<>cardinality(p_lines) THEN RAISE EXCEPTION 'Línea desconocida';END IF;
 SELECT jsonb_agg(jsonb_build_object('channel','whatsapp_support','line_key',x) ORDER BY ord) INTO chosen_routes FROM unnest(p_lines) WITH ORDINALITY t(x,ord);
 -- Only pending, never-started messages with a confirmed or equally safe pending predecessor.
 WITH RECURSIVE eligible AS (
  SELECT j.id,j.contact_id,j.campaign_sequence,j.campaign_step FROM public.multichannel_jobs j
  WHERE j.account_id=p_account AND j.campaign_id=c.id AND j.mode='whatsapp_live' AND j.status='queued' AND j.started_at IS NULL AND j.provider_id IS NULL
  AND (j.predecessor_id IS NULL OR EXISTS(SELECT 1 FROM public.multichannel_jobs p WHERE p.id=j.predecessor_id AND p.account_id=p_account AND p.status IN('accepted','delivered')))
  UNION ALL
  SELECT j.id,j.contact_id,j.campaign_sequence,j.campaign_step FROM public.multichannel_jobs j JOIN eligible e ON e.id=j.predecessor_id
  WHERE j.account_id=p_account AND j.campaign_id=c.id AND j.mode='whatsapp_live' AND j.status='queued' AND j.started_at IS NULL AND j.provider_id IS NULL
 ), ranked AS (SELECT *,dense_rank() OVER(ORDER BY campaign_sequence,contact_id) person FROM eligible), chosen AS (
 SELECT * FROM ranked WHERE p_action='save' OR p_unit='messages' OR person<=p_count ORDER BY campaign_sequence,campaign_step,id LIMIT CASE WHEN p_action='send' AND p_unit='messages' THEN p_count ELSE 21000 END
 ) SELECT array_agg(id ORDER BY campaign_sequence,campaign_step,id),count(DISTINCT contact_id) INTO ids,people FROM chosen;
 IF coalesce(cardinality(ids),0)=0 THEN RAISE EXCEPTION 'No hay pendientes seguros para enviar';END IF;
 IF EXISTS(SELECT 1 FROM public.multichannel_jobs WHERE id=ANY(ids) AND (NOT campaign_permission OR permission_expires_at IS NULL OR permission_expires_at<=c.expires_at)) THEN RAISE EXCEPTION 'Los permisos no cubren la campaña';END IF;
 UPDATE public.multichannel_campaigns SET routes=chosen_routes,distribution=NULL,dispatch_mode='sequential',interval_seconds=p_interval,block_size=p_block,block_pause_seconds=p_pause,
 manual_batch_job_ids=CASE WHEN p_action='send' THEN ids ELSE NULL END,manual_request_id=p_request,status=CASE WHEN p_action='send' THEN 'active' ELSE 'paused' END,technical_pause_at=NULL,updated_at=tick WHERE id=c.id;
 WITH ranked AS (SELECT id,row_number() OVER(ORDER BY campaign_sequence,campaign_step,id)-1 ord,dense_rank() OVER(ORDER BY campaign_sequence,contact_id)-1 person FROM public.multichannel_jobs WHERE id=ANY(ids))
 UPDATE public.multichannel_jobs j SET line_key=p_lines[1+(r.person%cardinality(p_lines))::int],campaign_primary_line_key=p_lines[1+(r.person%cardinality(p_lines))::int],campaign_lane_sequence=r.person,
 campaign_routes=jsonb_build_array(jsonb_build_object('channel','whatsapp_support','line_key',p_lines[1+(r.person%cardinality(p_lines))::int]))||(SELECT coalesce(jsonb_agg(x),'[]'::jsonb) FROM jsonb_array_elements(chosen_routes) x WHERE x->>'line_key'<>p_lines[1+(r.person%cardinality(p_lines))::int]),
 run_at=tick+make_interval(secs=>(r.ord*p_interval+CASE WHEN p_action='save' THEN (r.ord/p_block)*p_pause ELSE 0 END)::double precision),routing_alert=NULL
 FROM ranked r WHERE j.id=r.id;
 IF p_enable THEN UPDATE public.multichannel_whatsapp_session_lines SET paused=false WHERE account_id=p_account AND line_key=ANY(p_lines);END IF;
 RETURN jsonb_build_object('status',CASE WHEN p_action='send' THEN 'active' ELSE 'paused' END,'messages',cardinality(ids),'recipients',people,'limited',p_action='send');
END;$$;

CREATE FUNCTION public.finish_manual_campaign_batch() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status NOT IN('queued','claimed','dispatching') THEN
  UPDATE public.multichannel_campaigns c SET status='paused',technical_pause_at=NULL,updated_at=clock_timestamp()
  WHERE c.id=NEW.campaign_id AND c.account_id=NEW.account_id AND c.status='active' AND c.manual_batch_job_ids IS NOT NULL
  AND NEW.id=ANY(c.manual_batch_job_ids) AND NOT EXISTS(SELECT 1 FROM public.multichannel_jobs j WHERE j.account_id=c.account_id AND j.campaign_id=c.id AND j.id=ANY(c.manual_batch_job_ids) AND j.status IN('queued','claimed','dispatching'));
 END IF;RETURN NEW;
END;$$;
CREATE TRIGGER finish_manual_campaign_batch AFTER UPDATE OF status ON public.multichannel_jobs FOR EACH ROW EXECUTE FUNCTION public.finish_manual_campaign_batch();
DO $patch$ DECLARE source text;needle text:='and ca.status=''active'' and (';BEGIN
 source:=pg_get_functiondef('public.multichannel_campaign_worker_step(uuid,text,text,uuid,uuid,boolean,text,text,text)'::regprocedure);
 IF position(needle IN source)=0 THEN RAISE EXCEPTION 'Inspect worker selection before manual dispatch';END IF;
 source:=replace(source,needle,'and ca.status=''active'' and (ca.manual_batch_job_ids is null or q.id=any(ca.manual_batch_job_ids)) and (');
 source:=replace(source,'earlier.campaign_sequence<j.campaign_sequence and','earlier.campaign_sequence<j.campaign_sequence and (c.manual_batch_job_ids is null or earlier.id=any(c.manual_batch_job_ids)) and');
 IF position('if j.campaign_sequence>0 and' IN source)=0 THEN RAISE EXCEPTION 'Inspect block fence before manual dispatch';END IF;
 source:=replace(source,'if j.campaign_sequence>0 and','if c.manual_batch_job_ids is null and j.campaign_sequence>0 and');
 EXECUTE source;
END;$patch$;
REVOKE ALL ON FUNCTION public.adjust_campaign_dispatch(uuid,uuid,uuid,uuid,text,text[],integer,text,integer,integer,integer,boolean),public.finish_manual_campaign_batch() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_campaign_dispatch(uuid,uuid,uuid,uuid,text,text[],integer,text,integer,integer,integer,boolean) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
