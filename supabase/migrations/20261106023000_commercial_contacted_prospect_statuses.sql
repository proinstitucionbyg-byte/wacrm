-- Extend the existing shared catalog; tag capture and Sheets RPC keep their guards.
CREATE OR REPLACE FUNCTION crm_private.commercial_status_labels() RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT ARRAY['FUERA DE SERVICIO','VA A PAGAR','NO INTERESADO','APAGADO','TIMBRE OFF',
 'INCORRECTO','NO CONTESTA','DEVOLVER LLAMADA','ENVIAR INFORMACIÓN','INTERESADO',
 'SEGUIMIENTO DE VENTAS','VENTA','VENTA SOLO','SOLO QUIERE CURSO GRATIS','NO INTERESADO-R',
 'NÚMERO DE COMPETENCIA','CONTACTADO','PROSPECTO A COMPRAR']::text[]
$$;
REVOKE ALL ON FUNCTION crm_private.commercial_status_labels() FROM PUBLIC,anon,authenticated;
