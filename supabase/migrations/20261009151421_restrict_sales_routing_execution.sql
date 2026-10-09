-- Preserve server-only routing even when project defaults explicitly grant anon.
REVOKE ALL ON FUNCTION public.route_sales_conversation(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.route_sales_conversation(uuid,uuid,text) TO service_role;
REVOKE ALL ON FUNCTION public.configure_sales_routing(jsonb,boolean,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.configure_sales_routing(jsonb,boolean,integer) TO authenticated;
NOTIFY pgrst,'reload schema';
