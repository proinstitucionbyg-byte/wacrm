-- Ignore greetings and button numbers in the handoff summary.
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

-- An unclassified administrator may receive a chat without an area tag.
-- The old NULL comparison fell through and tried to create a tag with no name.
CREATE OR REPLACE FUNCTION crm_private.sync_inbox_area() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target_area text; tag_id uuid; boundary timestamptz;
BEGIN
  IF NEW.assigned_agent_id IS NULL THEN RETURN NEW; END IF;
  SELECT upper(btrim(area)) INTO target_area FROM public.profiles WHERE user_id=NEW.assigned_agent_id AND account_id=NEW.account_id;
  IF target_area IS NULL OR target_area NOT IN ('VENTAS','FIDELIZACION') THEN RETURN NEW; END IF;
  UPDATE public.conversations SET ai_handoff_area=CASE WHEN target_area='FIDELIZACION' THEN target_area ELSE NULL END WHERE id=NEW.id;
  DELETE FROM public.contact_tags ct USING public.tags t WHERE ct.tag_id=t.id AND ct.contact_id=NEW.contact_id AND t.account_id=NEW.account_id
    AND t.name IN ('AREA VENTAS','AREA FIDELIZACION','PENDIENTE DE ASIGNACION VENTAS') AND t.name<>'AREA '||target_area;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.account_id::text,0));
  SELECT id INTO tag_id FROM public.tags WHERE account_id=NEW.account_id AND name='AREA '||target_area ORDER BY created_at LIMIT 1;
  IF tag_id IS NULL THEN
    INSERT INTO public.tags(account_id,user_id,name,color,kind,audience) VALUES(NEW.account_id,NEW.user_id,'AREA '||target_area,'#06b6d4',
      CASE WHEN target_area='FIDELIZACION' THEN 'access' ELSE 'process' END,
      CASE WHEN target_area='FIDELIZACION' THEN '{"users":[],"areas":["FIDELIZACION"],"roles":[]}'::jsonb ELSE '{"users":[],"areas":[],"roles":[]}'::jsonb END) RETURNING id INTO tag_id;
  END IF;
  INSERT INTO public.contact_tags(contact_id,tag_id) VALUES(NEW.contact_id,tag_id) ON CONFLICT DO NOTHING;
  IF target_area='FIDELIZACION' THEN
    SELECT coalesce(max(created_at),now()) INTO boundary FROM public.messages WHERE conversation_id=NEW.id AND sender_type='customer';
    INSERT INTO crm_private.conversation_history_grants(conversation_id,user_id,visible_from)
      SELECT NEW.id,p.user_id,boundary FROM public.profiles p WHERE p.account_id=NEW.account_id AND upper(btrim(p.area))='FIDELIZACION' ON CONFLICT DO NOTHING;
    IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE user_id=OLD.assigned_agent_id AND account_id=NEW.account_id AND upper(btrim(area))='FIDELIZACION') THEN
      UPDATE crm_private.conversation_history_grants SET visible_from=boundary WHERE conversation_id=NEW.id AND user_id=NEW.assigned_agent_id;
    END IF;
    UPDATE public.conversation_sales_routes SET lease_expires_at=NULL WHERE conversation_id=NEW.id;
  END IF;
  RETURN NEW;
END $$;
