-- Cloud replies carry the selected title; numbered session replies must do
-- the same so existing keyword automations receive their original text.
do $migration$
declare definition text; old_return text;
begin
 definition:=pg_get_functiondef('public.resolve_whatsapp_session_menu_reply(uuid,text,uuid,uuid)'::regprocedure);
 old_return:='IF v_inbound.interactive_payload->>''kind''=''session_text_menu_reply'' THEN RETURN jsonb_build_object(''reply_id'',v_inbound.interactive_payload->>''reply_id'');END IF;';
 if position(old_return in definition)=0 then raise exception 'Unexpected menu resolver';end if;
 definition:=replace(definition,old_return,$code$
 IF v_inbound.interactive_payload->>'kind'='session_text_menu_reply' THEN
  SELECT m.* INTO v_prompt FROM public.messages m
   WHERE m.id=(v_inbound.interactive_payload->>'prompt_row_id')::uuid
    AND m.conversation_id=p_conversation_id AND m.whatsapp_session_line_key=p_line_key
    AND m.interactive_payload->>'consumed_by'=v_inbound.id::text;
  IF NOT FOUND THEN RETURN NULL;END IF;
  SELECT o INTO v_option FROM jsonb_array_elements(v_prompt.interactive_payload->'options') o
   WHERE o->>'id'=v_inbound.interactive_payload->>'reply_id';
  RETURN jsonb_build_object('reply_id',v_option->>'id','reply_title',v_option->>'title');
 END IF;$code$);
 definition:=replace(definition,'RETURN jsonb_build_object(''reply_id'',v_option->>''id'');','RETURN jsonb_build_object(''reply_id'',v_option->>''id'',''reply_title'',v_option->>''title'');');
 execute definition;
end;$migration$;
notify pgrst,'reload schema';
