-- Keep one database catalog for both tag capture and the restricted sheet RPC.
CREATE OR REPLACE FUNCTION crm_private.commercial_status_labels() RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT ARRAY['FUERA DE SERVICIO','VA A PAGAR','NO INTERESADO','APAGADO','TIMBRE OFF',
 'INCORRECTO','NO CONTESTA','DEVOLVER LLAMADA','ENVIAR INFORMACIÓN','INTERESADO',
 'SEGUIMIENTO DE VENTAS','VENTA','VENTA SOLO','SOLO QUIERE CURSO GRATIS','NO INTERESADO-R',
 'NÚMERO DE COMPETENCIA']::text[]
$$;
REVOKE ALL ON FUNCTION crm_private.commercial_status_labels() FROM PUBLIC,anon,authenticated;

DO $$ DECLARE definition text; BEGIN
 definition=pg_get_functiondef('public.sync_sales_commercial_status(uuid,uuid,text)'::regprocedure);
 definition=regexp_replace(definition,
   $rx$status_labels constant text\[\] := ARRAY\[[^]]*\];$rx$,
   'status_labels constant text[] := crm_private.commercial_status_labels();');
 IF position('status_labels constant text[] := crm_private.commercial_status_labels();' in definition)=0 THEN
   RAISE EXCEPTION 'Commercial catalog guard could not be updated';
 END IF;
 EXECUTE definition;
END $$;

DO $$ DECLARE a uuid='4d761b3c-4c6c-4986-bcd8-d95f1754fe35'; owner uuid; BEGIN
 SELECT user_id INTO owner FROM public.profiles WHERE account_id=a AND account_role='owner' LIMIT 1;
 IF owner IS NULL THEN RAISE EXCEPTION 'Account owner missing'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(a::text,0));
 IF NOT EXISTS(SELECT 1 FROM public.tags WHERE account_id=a AND name='NÚMERO DE COMPETENCIA') THEN
   INSERT INTO public.tags(account_id,user_id,name,color,kind,audience)
   VALUES(a,owner,'NÚMERO DE COMPETENCIA','#64748b','process',
     '{"users":[],"areas":["VENTAS"],"roles":["owner","admin","coordinator"]}'::jsonb);
 END IF;
END $$;
NOTIFY pgrst,'reload schema';
