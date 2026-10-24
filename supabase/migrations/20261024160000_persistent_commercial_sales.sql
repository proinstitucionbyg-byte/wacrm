-- Commercial history survives operational labels and area handoffs.
CREATE TABLE public.contact_sales_states (
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  commercial_status text,
  status_changed_at timestamptz NOT NULL DEFAULT now(),
  sale_at timestamptz,
  sales_owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  sales_owner_name text,
  explicitly_cleared boolean NOT NULL DEFAULT false,
  status_source text NOT NULL DEFAULT 'tag',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(account_id,contact_id)
);
CREATE INDEX contact_sales_states_owner ON public.contact_sales_states(account_id,sales_owner_id);
ALTER TABLE public.contact_sales_states ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contact_sales_states FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.contact_sales_states TO service_role;

CREATE FUNCTION crm_private.commercial_status_labels() RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT ARRAY['FUERA DE SERVICIO','VA A PAGAR','NO INTERESADO','APAGADO','TIMBRE OFF',
 'INCORRECTO','NO CONTESTA','DEVOLVER LLAMADA','ENVIAR INFORMACIÓN','INTERESADO',
 'SEGUIMIENTO DE VENTAS','VENTA','VENTA SOLO','SOLO QUIERE CURSO GRATIS','NO INTERESADO-R']::text[]
$$;
REVOKE ALL ON FUNCTION crm_private.commercial_status_labels() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION crm_private.commercial_sale_owner(p_account uuid,p_contact uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE owner_id uuid; owner_name text;
BEGIN
  SELECT a.agent_id,p.sales_adviser INTO owner_id,owner_name
  FROM public.payment_reviews p
  LEFT JOIN crm_private.message_sales_attribution a ON a.message_id=p.message_id
  WHERE p.account_id=p_account AND p.contact_id=p_contact
    AND (p.payment_purpose='enrollment' OR (p.payment_purpose='unclassified' AND
      (p.status='pending' OR EXISTS(SELECT 1 FROM public.enrollment_drafts e WHERE e.review_id=p.id AND e.status='registered'))))
    AND p.status IN ('pending','validated','observation')
  ORDER BY (p.status='validated') DESC,p.created_at DESC LIMIT 1;
  IF owner_name IS NULL THEN
    SELECT c.assigned_agent_id,upper(coalesce(nullif(btrim(p.nickname),''),p.full_name)) INTO owner_id,owner_name
    FROM public.conversations c JOIN public.profiles p ON p.user_id=c.assigned_agent_id AND p.account_id=c.account_id
    WHERE c.account_id=p_account AND c.contact_id=p_contact AND upper(p.area)='VENTAS'
    ORDER BY c.created_at DESC LIMIT 1;
  END IF;
  IF owner_name IS NULL AND EXISTS(SELECT 1 FROM public.contact_tags ct JOIN public.tags t ON t.id=ct.tag_id
      WHERE ct.contact_id=p_contact AND t.account_id=p_account AND t.name='ASESOR INSTITUTO') THEN
    owner_name='ASESOR INSTITUTO';
  END IF;
  IF owner_name='INSTITUCION' THEN owner_name='ASESOR INSTITUTO'; END IF;
  -- A legacy name is mapped to an ID only if exactly one account member matches.
  IF owner_id IS NULL AND owner_name IS NOT NULL AND owner_name<>'ASESOR INSTITUTO' THEN
    SELECT CASE WHEN count(*)=1 THEN (array_agg(p.user_id))[1] END INTO owner_id
    FROM public.profiles p WHERE p.account_id=p_account AND
      upper(coalesce(nullif(btrim(p.nickname),''),p.full_name))=upper(owner_name);
  END IF;
  RETURN jsonb_build_object('id',owner_id,'name',owner_name);
END $$;
REVOKE ALL ON FUNCTION crm_private.commercial_sale_owner(uuid,uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION crm_private.record_commercial_state(p_account uuid,p_contact uuid,p_status text,p_at timestamptz,p_source text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE previous public.contact_sales_states; owner jsonb; is_sale boolean; author uuid; label uuid;
BEGIN
  SELECT user_id INTO author FROM public.contacts WHERE id=p_contact AND account_id=p_account;
  IF NOT FOUND OR EXISTS(SELECT 1 FROM public.contacts WHERE id=p_contact AND
    regexp_replace(coalesce(phone_normalized,phone,''),'\D','','g') IN ('51987020644','987020644')) THEN RETURN; END IF;
  IF p_status IS NOT NULL AND NOT(p_status=ANY(crm_private.commercial_status_labels())) THEN
    RAISE EXCEPTION 'Unsupported commercial status' USING ERRCODE='22023';
  END IF;
  SELECT * INTO previous FROM public.contact_sales_states WHERE account_id=p_account AND contact_id=p_contact FOR UPDATE;
  IF FOUND AND p_source='area' THEN RETURN; END IF;
  IF previous.explicitly_cleared AND p_source IN ('payment','backfill') THEN RETURN; END IF;
  IF previous.sale_at IS NOT NULL AND p_source='tag' AND p_status NOT IN ('VENTA','VENTA SOLO') AND EXISTS(
    SELECT 1 FROM public.contact_tags ct JOIN public.tags t ON t.id=ct.tag_id
    WHERE ct.contact_id=p_contact AND t.account_id=p_account AND t.name='AREA FIDELIZACION') THEN RETURN; END IF;
  is_sale=coalesce(p_status IN ('VENTA','VENTA SOLO'),false);
  IF is_sale THEN owner=crm_private.commercial_sale_owner(p_account,p_contact); END IF;
  INSERT INTO public.contact_sales_states(account_id,contact_id,commercial_status,status_changed_at,sale_at,
    sales_owner_id,sales_owner_name,explicitly_cleared,status_source)
  VALUES(p_account,p_contact,p_status,coalesce(p_at,now()),CASE WHEN is_sale THEN coalesce(p_at,now()) END,
    (owner->>'id')::uuid,owner->>'name',false,p_source)
  ON CONFLICT(account_id,contact_id) DO UPDATE SET
    commercial_status=EXCLUDED.commercial_status,status_changed_at=EXCLUDED.status_changed_at,
    sale_at=coalesce(contact_sales_states.sale_at,EXCLUDED.sale_at),
    sales_owner_id=CASE WHEN contact_sales_states.sales_owner_name IS NULL OR contact_sales_states.sales_owner_name=EXCLUDED.sales_owner_name
      THEN coalesce(contact_sales_states.sales_owner_id,EXCLUDED.sales_owner_id) ELSE contact_sales_states.sales_owner_id END,
    sales_owner_name=coalesce(contact_sales_states.sales_owner_name,EXCLUDED.sales_owner_name),
    explicitly_cleared=(p_source='sheet' AND NOT coalesce(p_status IN ('VENTA','VENTA SOLO'),false) AND contact_sales_states.sale_at IS NOT NULL),
    status_source=p_source,updated_at=now();
  IF is_sale AND p_source IN ('payment','backfill') AND EXISTS(
    SELECT 1 FROM public.contact_tags ct JOIN public.tags t ON t.id=ct.tag_id
    WHERE ct.contact_id=p_contact AND t.account_id=p_account AND t.name='AREA VENTAS') AND NOT EXISTS(
    SELECT 1 FROM public.contact_tags ct JOIN public.tags t ON t.id=ct.tag_id
    WHERE ct.contact_id=p_contact AND t.account_id=p_account AND t.name='AREA FIDELIZACION') THEN
    SELECT id INTO label FROM public.tags WHERE account_id=p_account AND name='VENTA' AND kind='process' ORDER BY created_at LIMIT 1;
    IF label IS NOT NULL THEN INSERT INTO public.contact_tags(contact_id,tag_id) VALUES(p_contact,label) ON CONFLICT DO NOTHING; END IF;
  END IF;
  IF p_source='sheet' AND EXISTS(SELECT 1 FROM public.contact_tags ct JOIN public.tags t ON t.id=ct.tag_id
    WHERE ct.contact_id=p_contact AND t.account_id=p_account AND t.name='AREA FIDELIZACION') THEN
    DELETE FROM public.contact_tags ct USING public.tags t WHERE ct.tag_id=t.id AND ct.contact_id=p_contact
      AND t.account_id=p_account AND t.name=ANY(crm_private.commercial_status_labels());
  END IF;
END $$;
REVOKE ALL ON FUNCTION crm_private.record_commercial_state(uuid,uuid,text,timestamptz,text) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION crm_private.capture_commercial_contact_tag() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE label public.tags; next_status text; stamp timestamptz; account uuid; commercial_payment boolean;
BEGIN
  SELECT * INTO label FROM public.tags WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD.tag_id ELSE NEW.tag_id END;
  IF NOT FOUND THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
  account=label.account_id;
  IF TG_OP='DELETE' THEN
    -- Removing sales labels for a handoff never cancels the recorded sale.
    IF label.name=ANY(crm_private.commercial_status_labels()) AND label.name NOT IN ('VENTA','VENTA SOLO') AND EXISTS(
      SELECT 1 FROM public.contact_sales_states s WHERE s.account_id=account AND s.contact_id=OLD.contact_id
      AND s.commercial_status=label.name AND s.sale_at IS NULL) THEN
      SELECT t.name,ct.created_at INTO next_status,stamp FROM public.contact_tags ct JOIN public.tags t ON t.id=ct.tag_id
      WHERE ct.contact_id=OLD.contact_id AND t.account_id=account AND t.name=ANY(crm_private.commercial_status_labels())
      ORDER BY ct.created_at DESC LIMIT 1;
      PERFORM crm_private.record_commercial_state(account,OLD.contact_id,next_status,coalesce(stamp,now()),'tag');
    END IF;
    RETURN OLD;
  END IF;
  IF label.name=ANY(crm_private.commercial_status_labels()) THEN
    PERFORM crm_private.record_commercial_state(account,NEW.contact_id,label.name,NEW.created_at,'tag');
    -- One current commercial state; area, payment and responsible tags are separate.
    DELETE FROM public.contact_tags ct USING public.tags t WHERE ct.tag_id=t.id AND ct.contact_id=NEW.contact_id
      AND t.account_id=account AND t.name=ANY(crm_private.commercial_status_labels()) AND t.id<>label.id;
  ELSIF label.name IN ('AREA VENTAS','PAGO VALIDADO','PENDIENTE DE VALIDACION','AREA FIDELIZACION') THEN
    IF label.name='AREA VENTAS' THEN PERFORM crm_private.record_commercial_state(account,NEW.contact_id,NULL,NEW.created_at,'area'); END IF;
    SELECT EXISTS(SELECT 1 FROM public.payment_reviews p WHERE p.account_id=account AND p.contact_id=NEW.contact_id
      AND p.status IN ('pending','validated','observation') AND (p.payment_purpose='enrollment' OR
      (p.payment_purpose='unclassified' AND (EXISTS(SELECT 1 FROM public.enrollment_drafts e WHERE e.review_id=p.id AND e.status='registered') OR
        EXISTS(SELECT 1 FROM public.contact_tags ct JOIN public.tags t ON t.id=ct.tag_id WHERE ct.contact_id=NEW.contact_id AND t.account_id=account AND t.name='AREA VENTAS'))))) INTO commercial_payment;
    IF commercial_payment THEN PERFORM crm_private.record_commercial_state(account,NEW.contact_id,'VENTA',NEW.created_at,'payment'); END IF;
  END IF;
  IF label.name='AREA FIDELIZACION' THEN
    DELETE FROM public.contact_tags ct USING public.tags t WHERE ct.tag_id=t.id AND ct.contact_id=NEW.contact_id
      AND t.account_id=account AND (t.name=ANY(crm_private.commercial_status_labels()) OR
        t.name IN ('AREA VENTAS','ASESOR INSTITUTO','PENDIENTE DE ASIGNACION VENTAS'));
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION crm_private.capture_commercial_contact_tag() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER capture_commercial_contact_tag AFTER INSERT OR DELETE ON public.contact_tags
FOR EACH ROW EXECUTE FUNCTION crm_private.capture_commercial_contact_tag();

CREATE FUNCTION crm_private.capture_commercial_payment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NEW.status IN ('pending','validated','observation') AND (NEW.payment_purpose='enrollment' OR
    (NEW.payment_purpose='unclassified' AND (EXISTS(SELECT 1 FROM public.enrollment_drafts e WHERE e.review_id=NEW.id AND e.status='registered') OR
      (NEW.status IN ('pending','observation') AND EXISTS(SELECT 1 FROM public.contact_tags ct JOIN public.tags t ON t.id=ct.tag_id
        WHERE ct.contact_id=NEW.contact_id AND t.account_id=NEW.account_id AND t.name='AREA VENTAS'))))) THEN
    PERFORM crm_private.record_commercial_state(NEW.account_id,NEW.contact_id,'VENTA',coalesce(NEW.reviewed_at,NEW.created_at),'payment');
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION crm_private.capture_commercial_payment() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER zz_capture_commercial_payment AFTER INSERT OR UPDATE OF status,payment_purpose ON public.payment_reviews
FOR EACH ROW EXECUTE FUNCTION crm_private.capture_commercial_payment();

-- Extend the existing narrow write RPC; do not create another write endpoint.
DO $$ DECLARE definition text; BEGIN
  definition=pg_get_functiondef('public.sync_sales_commercial_status(uuid,uuid,text)'::regprocedure);
  definition=replace(definition,'IF NOT EXISTS (',
    'IF NOT EXISTS (SELECT 1 FROM public.contact_sales_states WHERE account_id=p_account_id AND contact_id=p_contact_id) AND NOT EXISTS (');
  definition=replace(definition,'  RETURN p_status;',
    E'  PERFORM crm_private.record_commercial_state(p_account_id,p_contact_id,p_status,now(),''sheet'');\n  RETURN p_status;');
  IF position('record_commercial_state' in definition)=0 THEN RAISE EXCEPTION 'Commercial RPC was not updated'; END IF;
  EXECUTE definition;
END $$;

-- Seed the full current commercial catalog without duplicate names.
DO $$ DECLARE a uuid='4d761b3c-4c6c-4986-bcd8-d95f1754fe35'; owner uuid; label text; item record; state text; stamp timestamptz; BEGIN
 SELECT user_id INTO owner FROM public.profiles WHERE account_id=a AND account_role='owner' LIMIT 1;
 IF owner IS NULL THEN RAISE EXCEPTION 'Account owner missing'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(a::text,0));
 FOREACH label IN ARRAY crm_private.commercial_status_labels() LOOP
   IF NOT EXISTS(SELECT 1 FROM public.tags WHERE account_id=a AND name=label) THEN
     INSERT INTO public.tags(account_id,user_id,name,color,kind,audience)
     VALUES(a,owner,label,CASE WHEN label IN ('VENTA','VENTA SOLO') THEN '#22c55e' ELSE '#8b5cf6' END,'process',
       '{"users":[],"areas":["VENTAS"],"roles":["owner","admin","coordinator"]}'::jsonb);
   END IF;
 END LOOP;
 -- Default unrestricted commercial labels become a visible Sales catalog.
 UPDATE public.tags SET audience='{"users":[],"areas":["VENTAS"],"roles":["owner","admin","coordinator"]}'::jsonb
 WHERE account_id=a AND name=ANY(crm_private.commercial_status_labels()) AND
   coalesce(jsonb_array_length(audience->'users'),0)=0 AND coalesce(jsonb_array_length(audience->'areas'),0)=0;
 FOR item IN SELECT c.id FROM public.contacts c WHERE c.account_id=a AND (
   EXISTS(SELECT 1 FROM public.contact_tags ct JOIN public.tags t ON t.id=ct.tag_id WHERE ct.contact_id=c.id AND
     (t.name IN ('AREA VENTAS','ASESOR INSTITUTO') OR t.name=ANY(crm_private.commercial_status_labels()))) OR
   EXISTS(SELECT 1 FROM public.payment_reviews p WHERE p.contact_id=c.id AND p.account_id=a AND
     p.status IN ('validated','pending','observation') AND (p.payment_purpose='enrollment' OR (p.payment_purpose='unclassified' AND
       EXISTS(SELECT 1 FROM public.enrollment_drafts e WHERE e.review_id=p.id AND e.status='registered')))) OR
   EXISTS(SELECT 1 FROM public.conversations v JOIN public.profiles p ON p.user_id=v.assigned_agent_id AND p.account_id=a
     WHERE v.id=(SELECT latest.id FROM public.conversations latest WHERE latest.contact_id=c.id AND latest.account_id=a
       ORDER BY latest.created_at DESC LIMIT 1) AND upper(p.area)='VENTAS')) LOOP
   state=NULL;stamp=NULL;
   SELECT t.name,ct.created_at INTO state,stamp FROM public.contact_tags ct JOIN public.tags t ON t.id=ct.tag_id
   WHERE ct.contact_id=item.id AND t.account_id=a AND t.name=ANY(crm_private.commercial_status_labels())
   ORDER BY ct.created_at DESC LIMIT 1;
   SELECT 'VENTA',coalesce(p.reviewed_at,p.created_at) INTO state,stamp FROM public.payment_reviews p WHERE p.account_id=a AND p.contact_id=item.id
     AND p.status IN ('validated','pending','observation') AND (p.payment_purpose='enrollment' OR (p.payment_purpose='unclassified' AND
       (EXISTS(SELECT 1 FROM public.enrollment_drafts e WHERE e.review_id=p.id AND e.status='registered') OR
        (p.status IN ('pending','observation') AND EXISTS(SELECT 1 FROM public.contact_tags ct JOIN public.tags t ON t.id=ct.tag_id
          WHERE ct.contact_id=item.id AND t.account_id=a AND t.name='AREA VENTAS')))))
     ORDER BY (p.status='validated') DESC,p.created_at LIMIT 1;
   IF NOT FOUND THEN
     SELECT t.name,ct.created_at INTO state,stamp FROM public.contact_tags ct JOIN public.tags t ON t.id=ct.tag_id
     WHERE ct.contact_id=item.id AND t.account_id=a AND t.name=ANY(crm_private.commercial_status_labels()) ORDER BY ct.created_at DESC LIMIT 1;
   END IF;
   PERFORM crm_private.record_commercial_state(a,item.id,state,coalesce(stamp,now()),'backfill');
 END LOOP;
 -- The ledger is durable; remove obsolete Sales labels from fidelity chats only.
 DELETE FROM public.contact_tags ct USING public.tags t WHERE ct.tag_id=t.id AND t.account_id=a
   AND (t.name=ANY(crm_private.commercial_status_labels()) OR t.name IN ('AREA VENTAS','ASESOR INSTITUTO','PENDIENTE DE ASIGNACION VENTAS'))
   AND EXISTS(SELECT 1 FROM public.contact_tags f JOIN public.tags ft ON ft.id=f.tag_id WHERE f.contact_id=ct.contact_id AND ft.account_id=a AND ft.name='AREA FIDELIZACION');
END $$;
NOTIFY pgrst,'reload schema';
