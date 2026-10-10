-- Presentation generation changes on every explicit assignment, including a new
-- transfer to the same adviser. Other conversation updates do not reset it.
ALTER TABLE public.conversations ADD COLUMN inbox_assignment_at timestamptz;
CREATE FUNCTION crm_private.mark_inbox_assignment() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  NEW.inbox_assignment_at=CASE WHEN NEW.assigned_agent_id IS NULL THEN NULL ELSE clock_timestamp() END;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION crm_private.mark_inbox_assignment() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER mark_inbox_assignment BEFORE INSERT OR UPDATE OF assigned_agent_id
ON public.conversations FOR EACH ROW EXECUTE FUNCTION crm_private.mark_inbox_assignment();

-- Keep the human decision and its evidence intact. Notify the responsible sales
-- adviser; when the commercial window has expired, route through the CEO's pool.
CREATE FUNCTION crm_private.follow_up_payment_decision() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE recipient uuid; result jsonb;
BEGIN
  IF NEW.status NOT IN ('rejected','observation') OR (NEW.status,NEW.version) IS NOT DISTINCT FROM (OLD.status,OLD.version) THEN RETURN NEW; END IF;
  SELECT c.assigned_agent_id INTO recipient FROM public.conversations c
    JOIN public.conversation_sales_routes r ON r.conversation_id=c.id
    WHERE c.id=NEW.conversation_id AND c.account_id=NEW.account_id
      AND r.agent_id=c.assigned_agent_id AND r.state='assigned' AND r.lease_expires_at>now();
  IF recipient IS NULL AND NEW.conversation_id IS NOT NULL THEN
    PERFORM set_config('crm.transfer_authorized','1',true);
    UPDATE public.conversations c SET assigned_agent_id=NULL WHERE c.id=NEW.conversation_id AND c.account_id=NEW.account_id
      AND EXISTS(SELECT 1 FROM public.conversation_sales_routes r WHERE r.conversation_id=c.id AND r.agent_id=c.assigned_agent_id AND r.lease_expires_at<=now());
    PERFORM set_config('crm.transfer_authorized','0',true);
    result=public.route_conversation_area(NEW.account_id,NEW.conversation_id,'VENTAS');
    recipient=nullif(result->>'agent_id','')::uuid;
  END IF;
  INSERT INTO public.notifications(account_id,user_id,type,title,body,target_url,dedup_key)
    SELECT NEW.account_id,p.user_id,'system_notice',
      CASE WHEN NEW.status='rejected' THEN 'PAGO NO VALIDADO - CONTACTAR AL ESTUDIANTE' ELSE 'PAGO EN OBSERVACION - CONTACTAR AL ESTUDIANTE' END,
      coalesce(NEW.note,'')||E'\nREVISAR EL COMPROBANTE Y CONTACTAR AL ESTUDIANTE. NO REGISTRAR LA MATRICULA HASTA SU VALIDACION.',
      '/inbox?c='||NEW.conversation_id::text,
      'payment-followup:'||NEW.id::text||':'||NEW.version::text
    FROM public.profiles p WHERE p.account_id=NEW.account_id
      AND (p.user_id=recipient OR p.account_role IN ('owner','admin'))
    ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION crm_private.follow_up_payment_decision() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER zz_follow_up_payment_decision AFTER UPDATE OF status,note
ON public.payment_reviews FOR EACH ROW EXECUTE FUNCTION crm_private.follow_up_payment_decision();
