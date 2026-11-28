BEGIN;
ALTER TABLE public.multichannel_campaigns ADD COLUMN technical_pause_at timestamptz;
CREATE FUNCTION public.clear_campaign_technical_pause() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF NEW.status<>'paused' OR (OLD.status='paused' AND NEW.technical_pause_at IS NOT DISTINCT FROM OLD.technical_pause_at) THEN NEW.technical_pause_at:=NULL;END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER campaign_manual_pause_fence BEFORE UPDATE OF status,name,body,sequence,sms_body,routes,distribution ON public.multichannel_campaigns FOR EACH ROW EXECUTE FUNCTION public.clear_campaign_technical_pause();
REVOKE ALL ON FUNCTION public.clear_campaign_technical_pause() FROM PUBLIC,anon,authenticated;
DO $patch$ DECLARE source text;needle text:='set status=''paused'',updated_at=tick where c.status=''active''';BEGIN
 source:=pg_get_functiondef('public.campaign_safety_sweep()'::regprocedure);
 IF position(needle IN source)=0 THEN RAISE EXCEPTION 'Inspect campaign safety sweep before patching';END IF;
 source:=replace(source,needle,'set status=''paused'',updated_at=tick,technical_pause_at=tick where c.status=''active''');
 IF position('get diagnostics paused_n=row_count;' IN lower(source))=0 THEN RAISE EXCEPTION 'Unexpected safety sweep structure';END IF;
 source:=replace(source,'get diagnostics paused_n=row_count;', $resume$
 get diagnostics paused_n=row_count;
 -- Only our technical pauses may resume. Manual pauses clear the marker.
 WITH resumed AS (
 UPDATE public.multichannel_campaigns c SET status='active',updated_at=tick,technical_pause_at=NULL
 WHERE c.status='paused' AND c.technical_pause_at IS NOT NULL AND c.expires_at>tick
 AND EXISTS(SELECT 1 FROM public.multichannel_jobs j WHERE j.campaign_id=c.id AND j.account_id=c.account_id AND j.status='queued' AND j.started_at IS NULL AND j.provider_id IS NULL)
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(c.routes) r JOIN public.multichannel_whatsapp_session_lines l ON l.account_id=c.account_id AND l.line_key=r->>'line_key' WHERE l.campaign_restricted)
 AND EXISTS(SELECT 1 FROM jsonb_array_elements(c.routes) r JOIN public.multichannel_whatsapp_session_lines l ON l.account_id=c.account_id AND l.line_key=r->>'line_key' JOIN public.multichannel_workers w ON w.id=l.worker_id AND w.account_id=l.account_id AND w.enabled WHERE r->>'channel'='whatsapp_support' AND NOT l.paused AND NOT l.campaign_restricted AND l.campaign_ready_at>=tick-interval '30 seconds')
 RETURNING c.id,c.account_id)
 UPDATE public.multichannel_jobs j SET routing_alert=NULL FROM resumed c WHERE j.campaign_id=c.id AND j.account_id=c.account_id AND j.status='queued' AND j.started_at IS NULL AND j.routing_alert='campaign_paused_no_available_line';
 $resume$);
 EXECUTE source;
END;$patch$;
COMMENT ON COLUMN public.multichannel_campaigns.technical_pause_at IS 'Only automatic no-line pauses; any manual pause clears this marker. Provider restrictions never auto-resume.';
NOTIFY pgrst,'reload schema';
COMMIT;
