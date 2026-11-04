-- Actual messages sent from the linked phone/Web profile. No message is sent
-- by this function and no customer inbound or billing evidence is fabricated.
create function public.record_whatsapp_session_phone_echo(p_worker_id uuid,p_line_key text,p_linked_phone text,p_recipient_phone text,p_provider_id text,p_occurred_at timestamptz,p_content_type text,p_text text,p_ack integer default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare worker public.multichannel_workers; owner_id uuid; v_contact_id uuid; conv_id uuid; msg public.messages; matched uuid[]; matched_job public.whatsapp_session_outbound_jobs; state text;out_state text;human boolean:=false;
begin
 if p_recipient_phone!~'^[1-9][0-9]{6,14}$' or length(p_provider_id) not between 1 and 1024 or p_occurred_at<now()-interval '24 hours' or p_occurred_at>now()+interval '5 minutes' or length(coalesce(p_text,''))>65536 or p_ack not between -1 and 4 then raise exception 'Invalid phone echo';end if;
 select * into worker from public.multichannel_workers where id=p_worker_id and enabled;
 if not found or not exists(select 1 from public.multichannel_whatsapp_session_lines where account_id=worker.account_id and worker_id=worker.id and line_key=p_line_key and linked_phone=p_linked_phone) then raise exception 'Unbound phone echo' using errcode='42501';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(worker.account_id::text||':contact:'||p_recipient_phone,0));
 select owner_user_id into strict owner_id from public.accounts where id=worker.account_id;
 select id into v_contact_id from public.contacts where account_id=worker.account_id and phone_normalized=p_recipient_phone;
 if v_contact_id is null then insert into public.contacts(account_id,user_id,phone,name,channel) values(worker.account_id,owner_id,p_recipient_phone,p_recipient_phone,'whatsapp') returning id into v_contact_id;end if;
 select id into conv_id from public.conversations where account_id=worker.account_id and public.conversations.contact_id=v_contact_id for update;
 if conv_id is null then insert into public.conversations(account_id,user_id,contact_id,automation_enabled,ai_enabled,ai_autoreply_disabled) values(worker.account_id,owner_id,v_contact_id,false,false,true) returning id into conv_id;end if;
 state:=case when p_ack=-1 then 'failed' when p_ack>=3 then 'read' when p_ack=2 then 'delivered' when p_ack=1 then 'sent' else 'sending' end;
 out_state:=case when p_ack=-1 then 'failed' when p_ack>=3 then 'read' when p_ack=2 then 'delivered' else 'accepted' end;
 select * into msg from public.messages where conversation_id=conv_id and message_id=p_provider_id and whatsapp_session_line_key=p_line_key;
 if not found then
  select array_agg(id) into matched from public.whatsapp_session_outbound_jobs where account_id=worker.account_id and line_key=p_line_key and conversation_id=conv_id and body=p_text and provider_message_id is null and status in ('dispatching','needs_review') and started_at between p_occurred_at-interval '2 minutes' and p_occurred_at+interval '2 minutes';
  if cardinality(matched)=1 then
   update public.whatsapp_session_outbound_jobs set status=out_state,provider_message_id=p_provider_id,claim_token=null,lease_until=null,finished_at=p_occurred_at where id=matched[1] returning * into matched_job;
   update public.messages set message_id=p_provider_id,status=state where id=matched_job.message_row_id returning * into msg;
  else
   insert into public.messages(conversation_id,sender_type,content_type,content_text,message_id,status,created_at,whatsapp_session_line_key)
   values(conv_id,'agent',p_content_type,nullif(p_text,''),p_provider_id,state,p_occurred_at,p_line_key) returning * into msg;human:=true;
  end if;
 else
  update public.messages set status=case when status='read' then 'read' when status='delivered' and state in ('sent','sending') then 'delivered' when status='sent' and state='sending' then 'sent' else state end where id=msg.id returning * into msg;
  update public.whatsapp_session_outbound_jobs set status=case when status='read' then 'read' when status='delivered' and out_state='accepted' then 'delivered' else out_state end,finished_at=p_occurred_at where message_row_id=msg.id;
  human:=msg.sender_type='agent' and msg.sender_id is null;
 end if;
 if human then
  update public.conversations set automation_enabled=false,ai_enabled=false,ai_autoreply_disabled=true,automation_disabled_at=greatest(coalesce(automation_disabled_at,'-infinity'),p_occurred_at),last_human_message_at=greatest(coalesce(last_human_message_at,'-infinity'),p_occurred_at) where id=conv_id;
  with repeated as(update public.whatsapp_session_outbound_jobs set status='cancelled',claim_token=null,lease_until=null,finished_at=now() where account_id=worker.account_id and line_key=p_line_key and conversation_id=conv_id and sender_type='agent' and status in ('queued','claimed') and started_at is null and body=p_text and created_at<=p_occurred_at returning message_row_id)
  update public.messages m set status='failed' from repeated r where m.id=r.message_row_id;
 end if;
 update public.conversations set last_message_text=coalesce(nullif(p_text,''),'[Archivo enviado desde WhatsApp]'),last_message_at=p_occurred_at,updated_at=now() where id=conv_id and (last_message_at is null or last_message_at<=p_occurred_at);
 return jsonb_build_object('recorded',true,'message_row_id',msg.id,'status',msg.status,'matched_queue',matched_job.id is not null);
end;$$;
revoke all on function public.record_whatsapp_session_phone_echo(uuid,text,text,text,text,timestamptz,text,text,integer) from public,anon,authenticated;
grant execute on function public.record_whatsapp_session_phone_echo(uuid,text,text,text,text,timestamptz,text,text,integer) to service_role;
notify pgrst,'reload schema';
