ALTER TABLE public.payment_reviews ADD COLUMN payment_purpose text NOT NULL DEFAULT 'unclassified'
  CHECK(payment_purpose IN ('unclassified','enrollment','tuition','other'));
GRANT UPDATE(payment_purpose) ON public.payment_reviews TO authenticated;
-- Existing intakes are not reclassified automatically. New approvals require an explicit purpose.
CREATE OR REPLACE FUNCTION crm_private.enrollment_after_payment() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NEW.status='validated' AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.payment_purpose='enrollment' THEN
      INSERT INTO public.enrollment_drafts(account_id,review_id,conversation_id,data,sales_adviser)
        SELECT NEW.account_id,NEW.id,NEW.conversation_id,jsonb_build_object('phone1',coalesce(c.phone,'')),NEW.sales_adviser
        FROM public.contacts c WHERE c.id=NEW.contact_id ON CONFLICT(review_id) DO NOTHING;
    ELSIF NEW.payment_purpose IN ('tuition','other') AND NEW.conversation_id IS NOT NULL THEN
      PERFORM public.route_conversation_area(NEW.account_id,NEW.conversation_id,'FIDELIZACION');
      INSERT INTO public.notifications(account_id,user_id,type,title,body,target_url,dedup_key)
        SELECT NEW.account_id,p.user_id,'system_notice','PAGO VALIDADO — GESTIONAR EN FIDELIZACION',
          CASE WHEN NEW.payment_purpose='tuition' THEN 'PENSION DE ESTUDIANTE. ' ELSE 'OTRO PAGO. ' END||'El CEO valido el abono. Continuar la gestion; no es una nueva venta ni matricula.',
          '/inbox?c='||NEW.conversation_id::text,'payment-fidelity:'||NEW.id::text
        FROM public.profiles p WHERE p.account_id=NEW.account_id AND (upper(btrim(p.area))='FIDELIZACION' OR p.account_role IN ('owner','admin')) ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END $$;
DO $$ DECLARE definition text; BEGIN
  definition=pg_get_functiondef('crm_private.guard_payment_decision()'::regprocedure);
  definition=replace(definition,'NEW.note=btrim',E'IF NEW.status=''validated'' AND NEW.payment_purpose=''unclassified'' THEN RAISE EXCEPTION ''Indica si el pago es una nueva matricula, pension u otro pago''; END IF;\n  NEW.note=btrim');
  EXECUTE definition;
  definition=pg_get_functiondef('public.configure_sales_routing(jsonb,boolean,integer)'::regprocedure);
  definition=replace(definition,'''SIN AREA'',''VENTAS'',''FIDELIZACION'',''ADMINISTRATIVA'',''FINANZAS''','''SIN AREA'',''VENTAS'',''FIDELIZACION'',''ADMINISTRATIVA'',''FINANZAS'',''AUDIOVISUAL'',''DOCENTES'',''COORDINADOR DE DOCENTES''');
  EXECUTE definition;
END $$;
DO $$ DECLARE definition text; signature text; BEGIN
  FOREACH signature IN ARRAY ARRAY['public.apply_member_preset(uuid,text)','public.attach_created_team_member(uuid,uuid,uuid,text,text,text)'] LOOP
    definition=pg_get_functiondef(signature::regprocedure);
    definition=replace(definition,'''ventas'',''fidelizacion'',''coordinador'',''administrador''','''ventas'',''fidelizacion'',''coordinador'',''administrador'',''audiovisual'',''docente'',''coordinador_docentes''');
    IF signature='public.apply_member_preset(uuid,text)' THEN
      definition=replace(definition,'when ''administrador'' then ''ADMINISTRATIVA''','when ''administrador'' then ''ADMINISTRATIVA'' when ''audiovisual'' then ''AUDIOVISUAL'' when ''docente'' then ''DOCENTES'' when ''coordinador_docentes'' then ''COORDINADOR DE DOCENTES''');
      definition=replace(definition,'when ''coordinador'' then ''COORDINADOR''','when ''coordinador'' then ''COORDINADOR'' when ''coordinador_docentes'' then ''COORDINADOR'' when ''docente'' then ''DOCENTE'' when ''audiovisual'' then ''AUDIOVISUAL''');
      definition=replace(definition,'(module=''enrollments'' and','(p_preset not in (''audiovisual'',''docente'',''coordinador_docentes'') and module=''enrollments'' and');
      definition=replace(definition,'(module=''payments'' and','(p_preset not in (''audiovisual'',''docente'',''coordinador_docentes'') and module=''payments'' and');
    END IF;
    EXECUTE definition;
  END LOOP;
END $$;
