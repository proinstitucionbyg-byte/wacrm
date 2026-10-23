CREATE OR REPLACE FUNCTION crm_private.attribute_institution_bot_reply()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  conv record;
  label_id uuid;
BEGIN
  IF NEW.sender_type <> 'bot' OR NEW.status = 'failed' THEN
    RETURN NEW;
  END IF;

  SELECT c.contact_id, c.account_id, c.assigned_agent_id, ct.user_id
    INTO conv
    FROM public.conversations c
    JOIN public.contacts ct ON ct.id = c.contact_id AND ct.account_id = c.account_id
   WHERE c.id = NEW.conversation_id;
  IF NOT FOUND OR conv.assigned_agent_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.contact_tags ct
      JOIN public.tags t ON t.id = ct.tag_id
     WHERE ct.contact_id = conv.contact_id
       AND t.account_id = conv.account_id
       AND t.name = 'AREA VENTAS'
  ) OR EXISTS (
    SELECT 1
      FROM public.contact_tags ct
      JOIN public.tags t ON t.id = ct.tag_id
     WHERE ct.contact_id = conv.contact_id
       AND t.account_id = conv.account_id
       AND t.name IN ('AREA FIDELIZACION', 'PAGO VALIDADO')
  ) THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(conv.account_id::text || ':advisor-institute', 0));
  SELECT id INTO label_id
    FROM public.tags
   WHERE account_id = conv.account_id AND name = 'ASESOR INSTITUTO'
   ORDER BY created_at, id
   LIMIT 1;
  IF label_id IS NULL THEN
    INSERT INTO public.tags(account_id, user_id, name, color, kind, audience)
    VALUES (conv.account_id, conv.user_id, 'ASESOR INSTITUTO', '#8b5cf6', 'process',
      '{"users":[],"areas":[],"roles":[]}'::jsonb)
    RETURNING id INTO label_id;
  END IF;

  INSERT INTO public.contact_tags(contact_id, tag_id)
  VALUES (conv.contact_id, label_id)
  ON CONFLICT (contact_id, tag_id) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[sales attribution] unable to tag bot reply for message %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION crm_private.attribute_institution_bot_reply() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS attribute_institution_bot_reply ON public.messages;
CREATE TRIGGER attribute_institution_bot_reply
AFTER INSERT ON public.messages
FOR EACH ROW EXECUTE FUNCTION crm_private.attribute_institution_bot_reply();

CREATE OR REPLACE FUNCTION crm_private.remove_institution_adviser_on_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.assigned_agent_id IS NULL OR NEW.assigned_agent_id IS NOT DISTINCT FROM OLD.assigned_agent_id THEN
    RETURN NEW;
  END IF;

  DELETE FROM public.contact_tags ct
   USING public.tags t
   WHERE ct.tag_id = t.id
     AND ct.contact_id = NEW.contact_id
     AND t.account_id = NEW.account_id
     AND t.name = 'ASESOR INSTITUTO';
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION crm_private.remove_institution_adviser_on_assignment() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS remove_institution_adviser_on_assignment ON public.conversations;
CREATE TRIGGER remove_institution_adviser_on_assignment
AFTER UPDATE OF assigned_agent_id ON public.conversations
FOR EACH ROW EXECUTE FUNCTION crm_private.remove_institution_adviser_on_assignment();
