-- Preserve all existing payment, handoff, inbound and idempotency guards.
-- Only move the owner's configured last-call threshold from 23h30 to 23h.
do $$
declare signature text; definition text;
begin
  foreach signature in array array[
    'public.sales_window_followup_candidates(uuid)',
    'public.sales_window_followup_is_current(uuid,uuid,uuid,uuid)'
  ] loop
    definition := pg_get_functiondef(signature::regprocedure);
    if position('23 hours 30 minutes' in definition)=0
       and position('23 hours' in definition)=0 then
      raise exception 'Closing threshold missing in %; no change applied',signature;
    end if;
    execute replace(definition,'23 hours 30 minutes','23 hours');
  end loop;
  update public.automations
  set trigger_config=(trigger_config-'schedule')||'{"window_before_minutes":60}'::jsonb
  where trigger_type='time_based'
    and trigger_config @> '{"internal_only":true,"sales_window_last_call":true}'::jsonb;
end $$;
