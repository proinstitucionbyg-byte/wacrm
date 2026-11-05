-- Extend the existing, account-bound reply queue. Never expose session jobs
-- to browser roles or deliver a media job as placeholder text to an old worker.
alter table public.multichannel_whatsapp_session_lines add column supports_media boolean not null default false;
alter table public.whatsapp_session_outbound_jobs add column media jsonb;
alter table public.whatsapp_session_outbound_jobs add constraint whatsapp_session_media_shape check (
 media is null or ((jsonb_typeof(media)='object'
 and media-array['kind','url','caption','filename']='{}'::jsonb
 and jsonb_typeof(media->'kind')='string' and media->>'kind' in('audio','image','video','document')
 and jsonb_typeof(media->'url')='string' and length(media->>'url') between 1 and 4096
 and (not(media?'caption') or (jsonb_typeof(media->'caption')='string' and length(media->>'caption')<=4000))
 and (not(media?'filename') or (jsonb_typeof(media->'filename')='string' and length(media->>'filename')<=200))) is true)
);

create function public.enqueue_whatsapp_session_media(
 p_account_id uuid,p_conversation_id uuid,p_line_key text,p_inbound_provider_message_id text,
 p_body text,p_dedup_key text,p_media jsonb,p_cloud_source boolean default false
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb; job public.whatsapp_session_outbound_jobs;
begin
 if (jsonb_typeof(p_media)='object' and p_media-array['kind','url','caption','filename']='{}'::jsonb
 and jsonb_typeof(p_media->'kind')='string' and p_media->>'kind' in('audio','image','video','document')
 and jsonb_typeof(p_media->'url')='string' and length(p_media->>'url') between 1 and 4096
 and p_media->>'url' ~ '^https://[a-z0-9.-]+/storage/v1/object/public/[^?#]+$'
 and (not(p_media?'caption') or (jsonb_typeof(p_media->'caption')='string' and length(p_media->>'caption')<=4000))
 and (not(p_media?'filename') or (jsonb_typeof(p_media->'filename')='string' and length(p_media->>'filename')<=200
 and strpos(p_media->>'filename','/')=0 and strpos(p_media->>'filename',chr(92))=0 and p_media->>'filename' !~ '[[:cntrl:]]'))) is distinct from true then
  raise exception 'Invalid session media' using errcode='22023';
 end if;
 if not exists(select 1 from public.multichannel_whatsapp_session_lines l join public.multichannel_workers w
 on w.id=l.worker_id and w.account_id=l.account_id where l.account_id=p_account_id and l.line_key=p_line_key
 and not l.paused and l.supports_media and w.enabled and l.support_ready_at>clock_timestamp()-interval '30 seconds') then
  raise exception 'A media-capable live session is required; no Cloud fallback' using errcode='42501';
 end if;
 if p_cloud_source then
  result:=public.enqueue_cloud_support_reply(p_account_id,p_conversation_id,p_line_key,p_inbound_provider_message_id,p_body,p_dedup_key,null,null);
 else
  result:=public.enqueue_whatsapp_session_text(p_account_id,p_conversation_id,p_line_key,p_inbound_provider_message_id,p_body,p_dedup_key);
 end if;
 select * into job from public.whatsapp_session_outbound_jobs where id=(result->>'job_id')::uuid
 and account_id=p_account_id and line_key=p_line_key and conversation_id=p_conversation_id for update;
 if not found then raise exception 'Missing queued media';end if;
 if (result->>'duplicate')::boolean then
  if job.media is distinct from p_media then raise exception 'Media deduplication conflict' using errcode='23505';end if;
 else
  update public.whatsapp_session_outbound_jobs set media=p_media where id=job.id;
  update public.messages set content_type=p_media->>'kind',media_url=p_media->>'url' where id=job.message_row_id;
 end if;
 return result;
end;$$;
revoke all on function public.enqueue_whatsapp_session_media(uuid,uuid,text,text,text,text,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.enqueue_whatsapp_session_media(uuid,uuid,text,text,text,text,jsonb,boolean) to service_role;
