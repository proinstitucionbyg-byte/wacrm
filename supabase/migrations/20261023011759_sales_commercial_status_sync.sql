CREATE OR REPLACE FUNCTION public.sync_sales_commercial_status(
  p_account_id uuid,
  p_contact_id uuid,
  p_status text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  contact_owner uuid;
  status_tag_id uuid;
  status_labels constant text[] := ARRAY[
    'FUERA DE SERVICIO', 'VA A PAGAR', 'NO INTERESADO', 'APAGADO',
    'TIMBRE OFF', 'INCORRECTO', 'NO CONTESTA', 'DEVOLVER LLAMADA',
    'ENVIAR INFORMACIÓN', 'INTERESADO', 'VENTA', 'VENTA SOLO',
    'SOLO QUIERE CURSO GRATIS', 'NO INTERESADO-R'
  ];
BEGIN
  IF p_status IS NOT NULL AND NOT (p_status = ANY(status_labels)) THEN
    RAISE EXCEPTION 'Unsupported commercial status' USING ERRCODE = '22023';
  END IF;

  SELECT c.user_id INTO contact_owner
  FROM public.contacts c
  WHERE c.id = p_contact_id AND c.account_id = p_account_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Contact not found' USING ERRCODE = 'P0002'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.contact_tags ct
    JOIN public.tags t ON t.id = ct.tag_id AND t.account_id = p_account_id
    WHERE ct.contact_id = p_contact_id
      AND (t.name = 'AREA VENTAS' OR (t.kind = 'process' AND t.name = ANY(status_labels)))
  ) AND NOT EXISTS (
    SELECT 1 FROM public.conversations c
    JOIN public.profiles p ON p.user_id = c.assigned_agent_id AND p.account_id = p_account_id
    WHERE c.contact_id = p_contact_id AND c.account_id = p_account_id
      AND lower(coalesce(p.area, '')) = 'ventas'
  ) THEN
    RAISE EXCEPTION 'Contact is not a sales lead' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.contact_tags ct
  USING public.tags t
  WHERE ct.tag_id = t.id AND ct.contact_id = p_contact_id
    AND t.account_id = p_account_id AND t.kind = 'process' AND t.name = ANY(status_labels);

  IF p_status IS NOT NULL THEN
    SELECT t.id INTO status_tag_id FROM public.tags t
    WHERE t.account_id = p_account_id AND t.kind = 'process' AND t.name = p_status
    ORDER BY t.created_at LIMIT 1;

    IF status_tag_id IS NULL THEN
      INSERT INTO public.tags(account_id, user_id, name, color, kind, audience)
      VALUES (p_account_id, contact_owner, p_status, '#8b5cf6', 'process', '{"users":[],"areas":[],"roles":[]}')
      RETURNING id INTO status_tag_id;
    END IF;

    INSERT INTO public.contact_tags(contact_id, tag_id)
    VALUES (p_contact_id, status_tag_id)
    ON CONFLICT (contact_id, tag_id) DO NOTHING;
  END IF;

  RETURN p_status;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_sales_commercial_status(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_sales_commercial_status(uuid, uuid, text) TO service_role;
NOTIFY pgrst, 'reload schema';
