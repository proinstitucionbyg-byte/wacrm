-- account_role is a PostgreSQL enum; cast to text before comparing with
-- optional role labels that are not enum values in older installations.
CREATE OR REPLACE FUNCTION crm_private.record_assignment_handoff_note()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  destination text;
  recent_requests text;
BEGIN
  SELECT coalesce(
      nullif(btrim(p.area), ''),
      CASE p.account_role::text
        WHEN 'owner' THEN 'DIRECCIÓN'
        WHEN 'admin' THEN 'ADMINISTRACIÓN'
        WHEN 'coordinator' THEN 'COORDINACIÓN'
        ELSE 'EQUIPO'
      END
    ) INTO destination
    FROM public.profiles p
   WHERE p.account_id = NEW.account_id AND p.user_id = NEW.assigned_agent_id;
  destination := coalesce(destination, 'EQUIPO');

  SELECT string_agg('• ' || left(regexp_replace(btrim(m.content_text), '\s+', ' ', 'g'), 180), E'\n'
                    ORDER BY m.created_at, m.id)
    INTO recent_requests
    FROM (
      SELECT content_text, created_at, id
        FROM public.messages
       WHERE conversation_id = NEW.id
         AND sender_type = 'customer'
         AND content_type IN ('text', 'audio')
         AND content_text IS NOT NULL
         AND length(btrim(content_text)) >= 12
       ORDER BY created_at DESC, id DESC
       LIMIT 3
    ) m;

  INSERT INTO public.contact_notes(account_id, contact_id, user_id, note_text)
  VALUES (
    NEW.account_id,
    NEW.contact_id,
    NEW.assigned_agent_id,
    'RESUMEN AUTOMÁTICO DE DERIVACIÓN · ' || upper(destination) || E'\n' ||
    'Lo que comunicó el contacto:' || E'\n' ||
    coalesce(recent_requests, '• Revisar el chat; no hay una solicitud escrita reciente.') || E'\n' ||
    'Pendiente: atender la solicitud y registrar el resultado.'
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Assignment note failed for conversation %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;
