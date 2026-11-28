BEGIN;
-- Fix only missing contact metadata backed by a validated WhatsApp job.
-- No routing, connection, permission, message, or campaign state is changed.
CREATE FUNCTION public.stamp_campaign_contact_channel() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF NEW.mode='whatsapp_live' AND NEW.channel='whatsapp_support' AND EXISTS(SELECT 1 FROM public.multichannel_whatsapp_session_lines l WHERE l.account_id=NEW.account_id AND l.line_key=NEW.line_key) THEN
  UPDATE public.contacts c SET channel='whatsapp' WHERE c.id=NEW.contact_id AND c.account_id=NEW.account_id AND c.channel IS NULL AND c.external_id IS NULL
  AND regexp_replace(coalesce(nullif(c.phone_normalized,''),c.phone,''),'[^0-9]','','g') IN(regexp_replace(NEW.recipient,'[^0-9]','','g'),CASE WHEN NEW.recipient ~ '^\+519[0-9]{8}$' THEN substring(NEW.recipient FROM 4) END);
 END IF;RETURN NEW;
END;$$;
CREATE TRIGGER stamp_campaign_contact_channel AFTER INSERT ON public.multichannel_jobs FOR EACH ROW EXECUTE FUNCTION public.stamp_campaign_contact_channel();
REVOKE ALL ON FUNCTION public.stamp_campaign_contact_channel() FROM PUBLIC,anon,authenticated;
UPDATE public.contacts c SET channel='whatsapp'
WHERE c.account_id='4d761b3c-4c6c-4986-bcd8-d95f1754fe35' AND c.channel IS NULL AND c.external_id IS NULL
AND EXISTS(SELECT 1 FROM public.multichannel_jobs j JOIN public.multichannel_whatsapp_session_lines l ON l.account_id=j.account_id AND l.line_key=j.line_key
 WHERE j.account_id=c.account_id AND j.contact_id=c.id AND j.mode='whatsapp_live' AND j.channel='whatsapp_support'
 AND regexp_replace(coalesce(nullif(c.phone_normalized,''),c.phone,''),'[^0-9]','','g') IN(regexp_replace(j.recipient,'[^0-9]','','g'),CASE WHEN j.recipient ~ '^\+519[0-9]{8}$' THEN substring(j.recipient FROM 4) END));
COMMIT;
