-- Delivery updates and historical imports must not undo a later human resume.
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.record_whatsapp_session_phone_echo(uuid,text,text,text,text,timestamptz,text,text,integer)'::regprocedure);
 if position('human:=msg.sender_type=''agent'' and msg.sender_id is null;' in definition)=0 then raise exception 'Unexpected echo function; review before changing';end if;
 definition:=replace(definition,'human:=msg.sender_type=''agent'' and msg.sender_id is null;','human:=false;');
 definition:=regexp_replace(definition,'where id=conv_id;[[:space:]]+with repeated','where id=conv_id and p_occurred_at>=now()-interval ''5 minutes'';'||chr(10)||'  with repeated');
 if position('where id=conv_id and p_occurred_at>=now()-interval ''5 minutes'';' in definition)=0 then raise exception 'Historical echo guard was not applied';end if;
 execute definition;
end;$$;
