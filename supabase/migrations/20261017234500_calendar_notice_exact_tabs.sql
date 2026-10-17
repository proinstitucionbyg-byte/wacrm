-- Preserve all current report rules; change only the group-notice destination.
DO $$ DECLARE definition text; BEGIN
  definition=pg_get_functiondef('public.publish_operational_notices()'::regprocedure);
  IF position('coalesce(item.m->>''group_url'',item.source_url)' IN definition)=0 THEN
    IF position(',item.source_url,' IN definition)=0 THEN RAISE EXCEPTION 'No se encontro el enlace de ingreso a grupos'; END IF;
    definition=replace(definition,',item.source_url,',',coalesce(item.m->>''group_url'',item.source_url),');
    EXECUTE definition;
  END IF;
  definition=pg_get_functiondef('public.sync_academic_calendar(uuid,jsonb,text)'::regprocedure);
  IF position('MOTIVO: ' IN definition)=0 THEN
    IF position('(r->>''start_date''),E' IN definition)=0 THEN RAISE EXCEPTION 'Revisar funcion de cambios de inicio'; END IF;
    definition=replace(definition,'(r->>''start_date''),E','(r->>''start_date'')||CASE WHEN nullif(r->>''change_reason'','''') IS NOT NULL THEN '' — MOTIVO: ''||(r->>''change_reason'') ELSE '''' END,E');
    EXECUTE definition;
  END IF;
END $$;
