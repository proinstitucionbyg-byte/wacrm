-- Guard both legacy permission overloads and reset paths. No other permission
-- is changed. Applying a recommended preset preserves explicit CEO decisions.
DO $$ DECLARE definition text; function_id regprocedure; BEGIN
 FOREACH function_id IN ARRAY ARRAY['public.set_member_permission(uuid,uuid,boolean)'::regprocedure,'public.reset_member_permission(uuid,uuid)'::regprocedure] LOOP
  definition=pg_get_functiondef(function_id);
  IF position('IF v_target_account_id <> v_caller_account_id THEN' in definition)=0 THEN RAISE EXCEPTION 'Unexpected permission overload'; END IF;
  definition=replace(definition,'IF v_target_account_id <> v_caller_account_id THEN',
   'IF v_caller_role<>''owner'' AND EXISTS(SELECT 1 FROM public.permission_definitions WHERE id=p_permission_id AND module=''inbox_management'') THEN RAISE EXCEPTION ''Solo el CEO puede modificar estos permisos'' USING ERRCODE=''42501''; END IF;
    IF v_target_account_id <> v_caller_account_id THEN');
  EXECUTE definition;
 END LOOP;
 definition=pg_get_functiondef('public.apply_member_preset(uuid,text)'::regprocedure);
 IF position('from public.permission_definitions' in definition)=0 THEN RAISE EXCEPTION 'Unexpected preset implementation'; END IF;
 definition=replace(definition,'from public.permission_definitions','from public.permission_definitions where module<>''inbox_management''');
 EXECUTE definition;
END $$;
-- These existing RPCs require a signed-in caller internally; do not expose
-- permission introspection or delegation to the anonymous API role.
REVOKE EXECUTE ON FUNCTION public.get_member_permissions(uuid),public.has_member_permission(uuid,text,text),public.set_member_permission(uuid,text,text,boolean),public.set_member_permission(uuid,uuid,boolean),public.reset_member_permission(uuid,uuid) FROM anon;
