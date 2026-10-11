CREATE FUNCTION crm_private.guard_inbox_clear() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF (TG_OP='INSERT' AND NEW.inbox_cleared_at IS NOT NULL) OR (TG_OP='UPDATE' AND NEW.inbox_cleared_at IS DISTINCT FROM OLD.inbox_cleared_at) THEN
  IF auth.uid() IS NOT NULL AND NOT public.has_member_permission(auth.uid(),'inbox_management','conversations') THEN
   RAISE EXCEPTION 'Solo CEO o un usuario delegado puede eliminar o recuperar chats' USING ERRCODE='42501';
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION crm_private.guard_inbox_clear() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_inbox_clear BEFORE INSERT OR UPDATE OF inbox_cleared_at ON public.conversations FOR EACH ROW EXECUTE FUNCTION crm_private.guard_inbox_clear();
