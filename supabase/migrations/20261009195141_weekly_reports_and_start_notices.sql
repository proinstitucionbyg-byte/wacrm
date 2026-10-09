-- Only the server scheduler creates these deduplicated notices.
CREATE FUNCTION public.publish_operational_notices() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE today date=(now() AT TIME ZONE 'America/Lima')::date; item record; person record; count_contacts integer; count_messages integer; count_sales integer; report text; total integer=0; week_start timestamptz; week_end timestamptz;
BEGIN
  FOR item IN SELECT s.account_id,s.source_url,m FROM public.academic_calendar_snapshots s CROSS JOIN LATERAL jsonb_array_elements(s.modules) m
    WHERE s.updated_at>now()-interval '30 minutes' AND (m->>'start_date')::date BETWEEN today AND today+5 LOOP
    INSERT INTO public.notifications(account_id,user_id,type,title,body,target_url,dedup_key)
      SELECT item.account_id,p.user_id,'system_notice','PREPARAR INGRESO A GRUPOS',
      (item.m->>'course')||E'\nMODULO: '||(item.m->>'module')||E'\nINICIO: '||(item.m->>'start_date')||E'\nREVISAR LA LISTA WHATSAPP DEL CURSO Y AGREGAR LOS ESTUDIANTES PENDIENTES.',item.source_url,
      'start:'||(item.m->>'course')||':'||(item.m->>'start_date')
      FROM public.profiles p WHERE p.account_id=item.account_id AND (upper(btrim(p.area))='FIDELIZACION' OR p.account_role IN ('owner','admin')) ON CONFLICT DO NOTHING;
  END LOOP;
  IF extract(isodow FROM today)<>5 OR extract(hour FROM now() AT TIME ZONE 'America/Lima')<22 THEN RETURN total; END IF;
  week_end=(today::timestamp+interval '22 hours') AT TIME ZONE 'America/Lima';
  week_start=week_end-interval '7 days';
  FOR item IN SELECT DISTINCT account_id FROM public.profiles LOOP
    report='PERIODO: '||to_char(week_start AT TIME ZONE 'America/Lima','DD/MM HH24:MI')||' A '||to_char(week_end AT TIME ZONE 'America/Lima','DD/MM HH24:MI')||E'\n';
    FOR person IN SELECT user_id,coalesce(nullif(btrim(nickname),''),full_name,'SIN APODO') AS name,coalesce(nullif(upper(btrim(area)),''),'SIN AREA') AS area FROM public.profiles WHERE account_id=item.account_id ORDER BY area,name LOOP
      SELECT count(DISTINCT c.contact_id),count(*) INTO count_contacts,count_messages FROM public.messages m JOIN public.conversations c ON c.id=m.conversation_id
        WHERE c.account_id=item.account_id AND m.sender_type='agent' AND m.sender_id=person.user_id AND m.status IN ('sent','delivered','read') AND m.created_at>=week_start AND m.created_at<week_end;
      SELECT count(*) INTO count_sales FROM public.enrollment_drafts e JOIN public.payment_reviews r ON r.id=e.review_id
        WHERE e.account_id=item.account_id AND e.status='registered' AND r.reviewed_at>=week_start AND r.reviewed_at<week_end AND r.sales_adviser=person.name;
      report=report||E'\n'||person.area||' / '||upper(person.name)||E'\nCONTACTOS ATENDIDOS: '||count_contacts||' | MENSAJES HUMANOS: '||count_messages||' | MATRICULAS REGISTRADAS CON PAGO VALIDADO: '||count_sales||E'\n';
    END LOOP;
    report=report||E'\nSOLUCIONES Y MOTIVOS DE QUEJAS: SIN CLASIFICACION ESTRUCTURADA; NO SE INFIEREN DEL NUMERO DE MENSAJES. LOS CONTACTOS PUEDEN HABER SIDO ATENDIDOS POR MAS DE UNA PERSONA. AREA Y APODO SEGUN EL PERFIL ACTUAL.';
    INSERT INTO public.notifications(account_id,user_id,type,title,body,dedup_key)
      SELECT item.account_id,p.user_id,'system_notice','REPORTE SEMANAL DEL EQUIPO',report,'weekly:'||today::text
      FROM public.profiles p WHERE p.account_id=item.account_id AND p.account_role IN ('owner','admin') ON CONFLICT DO NOTHING;
    total=total+1;
  END LOOP;
  RETURN total;
END $$;
REVOKE ALL ON FUNCTION public.publish_operational_notices() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.publish_operational_notices() TO service_role;

-- Fidelity is a shared queue; the sales timeout must not evict its assignees.
CREATE FUNCTION crm_private.keep_fidelity_assignment() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM public.profiles p WHERE p.account_id=NEW.account_id AND p.user_id=NEW.agent_id AND upper(btrim(p.area))='FIDELIZACION') THEN NEW.lease_expires_at=NULL; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION crm_private.keep_fidelity_assignment() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER keep_fidelity_assignment BEFORE INSERT OR UPDATE ON public.conversation_sales_routes FOR EACH ROW EXECUTE FUNCTION crm_private.keep_fidelity_assignment();
CREATE OR REPLACE FUNCTION crm_private.sync_inbox_area() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target_area text; tag_id uuid; boundary timestamptz;
BEGIN
  IF NEW.assigned_agent_id IS NULL THEN RETURN NEW; END IF;
  SELECT upper(btrim(area)) INTO target_area FROM public.profiles WHERE user_id=NEW.assigned_agent_id AND account_id=NEW.account_id;
  IF target_area NOT IN ('VENTAS','FIDELIZACION') THEN RETURN NEW; END IF;
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
