DO $$ DECLARE definition text; BEGIN
  definition=pg_get_functiondef('crm_private.enrollment_after_payment()'::regprocedure);
  definition=replace(definition,'PERFORM public.route_conversation_area(NEW.account_id,NEW.conversation_id,''FIDELIZACION'');',E'PERFORM set_config(''crm.transfer_authorized'',''1'',true);\n      PERFORM public.route_conversation_area(NEW.account_id,NEW.conversation_id,''FIDELIZACION'');\n      PERFORM set_config(''crm.transfer_authorized'',''0'',true);');
  EXECUTE definition;
END $$;
