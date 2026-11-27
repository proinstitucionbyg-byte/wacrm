-- Preserve explicit primary ranges and an accepted recipient's sequence line.
-- Technical fallback roots share work across the originally selected ready lines.
DO $migration$
DECLARE source text;
BEGIN
 SELECT pg_get_functiondef(p.oid) INTO source FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname='multichannel_campaign_worker_step';
 IF position('order by case when j.predecessor_id is not null and sl.line_key=(select previous.line_key from public.multichannel_jobs previous where previous.id=j.predecessor_id and previous.account_id=j.account_id) then 0 else 1 end,position limit 1;' in source)=0 THEN RAISE EXCEPTION 'Inspect live campaign routing before applying redistribution'; END IF;
 source:=replace(source,'order by case when j.predecessor_id is not null and sl.line_key=(select previous.line_key from public.multichannel_jobs previous where previous.id=j.predecessor_id and previous.account_id=j.account_id) then 0 else 1 end,position limit 1;','order by
      case when j.predecessor_id is not null and sl.line_key=(select previous.line_key from public.multichannel_jobs previous where previous.id=j.predecessor_id and previous.account_id=j.account_id) then 0
        when sl.line_key=coalesce(j.campaign_primary_line_key,c.routes->0->>''line_key'') then 1 else 2 end,
      (select count(*) from public.multichannel_jobs assigned where assigned.campaign_id=j.campaign_id
        and assigned.predecessor_id is null and assigned.line_key=sl.line_key
        and assigned.status in (''claimed'',''dispatching'',''accepted'',''delivered'',''needs_review'')),
      position limit 1;');
 EXECUTE source;
END $migration$;
