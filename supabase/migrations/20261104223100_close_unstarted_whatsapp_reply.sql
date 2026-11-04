-- A local pause/obsolete inbound can reject a reservation before authorize.
-- Closing that unstarted reservation must release the shared worker queue.
do $migration$
declare definition text;
begin
 definition:=pg_get_functiondef('public.whatsapp_session_outbound_step(uuid,text,text,uuid,uuid,text,text)'::regprocedure);
 if position(' if p_action=''ack'' then' in definition)=0 then raise exception 'Unexpected outbound wrapper';end if;
 definition:=replace(definition,' if p_action=''ack'' then',$code$
 if p_action='record' and p_state in ('cancelled','needs_review') and p_provider_message_id is null then
  select * into worker from public.multichannel_workers where id=p_worker_id and enabled;
  if not found then raise exception 'Worker unavailable' using errcode='42501';end if;
  select * into job from public.whatsapp_session_outbound_jobs where id=p_job_id
   and account_id=worker.account_id and worker_id=worker.id and line_key=p_line_key for update;
  if found and job.status='claimed' and job.started_at is null and job.provider_message_id is null
   and job.claim_token=p_claim_token and job.lease_until>tick then
   update public.whatsapp_session_outbound_jobs set status=p_state,finished_at=tick,claim_token=null,lease_until=null where id=job.id;
   update public.messages set status='failed' where id=job.message_row_id;
   return jsonb_build_object('recorded',true,'status',p_state,'message_id',null);
  end if;
 end if;
 if p_action='ack' then$code$);
 execute definition;
end;$migration$;
notify pgrst,'reload schema';
