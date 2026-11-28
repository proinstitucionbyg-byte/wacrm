BEGIN;
CREATE FUNCTION public.queue_technical_line_recovery() RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE tick timestamptz:=clock_timestamp();n integer;
BEGIN
 INSERT INTO public.whatsapp_management_commands(account_id,worker_id,line_key,operation,expected_phone)
 SELECT DISTINCT ON(w.id) w.account_id,w.id,l.line_key,'recover',l.linked_phone
 FROM public.multichannel_workers w
 JOIN public.whatsapp_management_state s ON s.worker_id=w.id AND s.account_id=w.account_id
 CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(s.snapshot)='array' THEN s.snapshot ELSE '[]'::jsonb END) e
 JOIN public.multichannel_whatsapp_session_lines l ON l.account_id=w.account_id AND l.worker_id=w.id AND l.line_key=e->>'lineKey' AND l.linked_phone=e->>'linkedPhone'
 WHERE w.enabled AND s.seen_at>=tick-interval '20 seconds' AND e->>'active'='true' AND coalesce(e->>'archived','false')<>'true'
 AND e->>'status'='connection_error' AND NOT l.campaign_restricted
 AND NOT EXISTS(SELECT 1 FROM public.whatsapp_management_commands m WHERE m.worker_id=w.id AND m.status IN('pending','running'))
 AND NOT EXISTS(SELECT 1 FROM public.whatsapp_management_commands m WHERE m.worker_id=w.id AND m.line_key=l.line_key AND m.created_at>tick-interval '5 minutes')
 ORDER BY w.id,EXISTS(SELECT 1 FROM public.multichannel_campaigns c CROSS JOIN LATERAL jsonb_array_elements(c.routes) r WHERE c.account_id=w.account_id AND (c.status='active' OR(c.status='paused' AND c.technical_pause_at IS NOT NULL)) AND r->>'line_key'=l.line_key) DESC,l.line_key
 ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS n=ROW_COUNT;RETURN n;
END;$$;
REVOKE ALL ON FUNCTION public.queue_technical_line_recovery() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.queue_technical_line_recovery() TO service_role;
ALTER FUNCTION public.campaign_safety_sweep() RENAME TO campaign_safety_sweep_before_line_recovery;
CREATE FUNCTION public.campaign_safety_sweep() RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE result jsonb;n integer;BEGIN
 result:=public.campaign_safety_sweep_before_line_recovery();
 n:=public.queue_technical_line_recovery();
 RETURN result||jsonb_build_object('technical_recoveries_queued',n);
END;$$;
REVOKE ALL ON FUNCTION public.campaign_safety_sweep() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.campaign_safety_sweep() TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
