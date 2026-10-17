-- Adding a deep link must not announce that every course was rescheduled.
DO $$ DECLARE definition text; BEGIN
  definition=pg_get_functiondef('public.sync_academic_calendar(uuid,jsonb,text)'::regprocedure);
  IF position('previous<>p_modules' IN definition)=0 THEN RAISE EXCEPTION 'Revisar comparacion del calendario'; END IF;
  definition=replace(definition,'previous<>p_modules','(SELECT jsonb_agg(x-''group_url''-''change_reason'' ORDER BY x->>''course'',x->>''start_date'') FROM jsonb_array_elements(previous) x) IS DISTINCT FROM (SELECT jsonb_agg(x-''group_url''-''change_reason'' ORDER BY x->>''course'',x->>''start_date'') FROM jsonb_array_elements(p_modules) x)');
  definition=replace(definition,'WHERE NOT previous @> jsonb_build_array(r)','WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(previous) old WHERE (old-''group_url''-''change_reason'')=(r-''group_url''-''change_reason''))');
  EXECUTE definition;
END $$;
