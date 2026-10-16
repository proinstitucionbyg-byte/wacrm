-- Keep a short, factual handoff in the contact's existing Notes panel.
-- The assignment trigger covers manual, AI, sales and team-chat transfers.
CREATE OR REPLACE FUNCTION crm_private.record_assignment_handoff_note()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  destination text;
  recent_requests text;
BEGIN
  SELECT coalesce(nullif(btrim(NEW.ai_handoff_area), ''), nullif(btrim(p.area), ''), 'EQUIPO')
    INTO destination
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
         AND btrim(content_text) <> ''
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
    coalesce(recent_requests, '• Revisar el chat; no hay un mensaje escrito reciente.') || E'\n' ||
    'Pendiente: atender la solicitud y registrar el resultado.'
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never reject a legitimate transfer because a context note failed.
  RAISE WARNING 'Assignment note failed for conversation %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION crm_private.record_assignment_handoff_note() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS record_assignment_handoff_note ON public.conversations;
CREATE TRIGGER record_assignment_handoff_note
AFTER UPDATE OF assigned_agent_id ON public.conversations
FOR EACH ROW
WHEN (OLD.assigned_agent_id IS DISTINCT FROM NEW.assigned_agent_id AND NEW.assigned_agent_id IS NOT NULL)
EXECUTE FUNCTION crm_private.record_assignment_handoff_note();
