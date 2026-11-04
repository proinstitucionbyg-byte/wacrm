-- Keep the audit row; confirmed advertising free-entry sends are exempt from
-- the internal service-message allowance, including evidence arriving late.
alter table public.whatsapp_service_message_reservations drop constraint whatsapp_service_message_reservations_status_check;
alter table public.whatsapp_service_message_reservations add constraint whatsapp_service_message_reservations_status_check check(status in ('reserved','sent','delivered','failed','exempt'));

create function public.classify_service_reservation_evidence() returns trigger language plpgsql security invoker set search_path='' as $$
declare evidence public.messages;
begin
 select m.* into evidence from public.messages m join public.conversations c on c.id=m.conversation_id and c.account_id=new.account_id
 where m.id=new.source_message_row_id or (new.source_message_row_id is null and m.message_id=new.message_id) limit 1;
 if found then
  if evidence.billing_billable=false and (evidence.billing_type='free_entry_point' or evidence.billing_category='referral_conversion') then new.status:='exempt';
  elsif new.status='exempt' then new.status:=case when evidence.status='failed' then 'failed' when evidence.status in ('delivered','read') then 'delivered' when evidence.status='sent' then 'sent' else 'reserved' end;
  end if;
 end if;
 return new;
end;$$;
create trigger classify_service_reservation_evidence before insert or update of message_id,status,source_message_row_id on public.whatsapp_service_message_reservations for each row execute function public.classify_service_reservation_evidence();

create function public.reconcile_meta_free_entry_allowance() returns trigger language plpgsql security invoker set search_path='' as $$
declare owner_account uuid;exempt boolean;
begin
 if tg_op='UPDATE' and (old.billing_billable,old.billing_type,old.billing_category) is not distinct from (new.billing_billable,new.billing_type,new.billing_category) then return new;end if;
 select account_id into owner_account from public.conversations where id=new.conversation_id;
 exempt:=coalesce(new.billing_billable=false and (new.billing_type='free_entry_point' or new.billing_category='referral_conversion'),false);
 update public.whatsapp_service_message_reservations r set status=case when exempt then 'exempt' when new.status='failed' then 'failed' when new.status in ('delivered','read') then 'delivered' when new.status='sent' then 'sent' else 'reserved' end,updated_at=clock_timestamp()
 where r.account_id=owner_account and (r.source_message_row_id=new.id or (r.source_message_row_id is null and r.message_id=new.message_id))
  and (exempt and r.status in ('reserved','sent','delivered') or not exempt and r.status='exempt');
 return new;
end;$$;
create trigger reconcile_meta_free_entry_allowance after insert or update of billing_billable,billing_type,billing_category on public.messages for each row execute function public.reconcile_meta_free_entry_allowance();
revoke all on function public.classify_service_reservation_evidence(),public.reconcile_meta_free_entry_allowance() from public,anon,authenticated;
grant execute on function public.classify_service_reservation_evidence(),public.reconcile_meta_free_entry_allowance() to service_role;

update public.whatsapp_service_message_reservations r set status='exempt',updated_at=clock_timestamp()
from public.messages m join public.conversations c on c.id=m.conversation_id
where c.account_id=r.account_id and (m.id=r.source_message_row_id or (r.source_message_row_id is null and m.message_id=r.message_id))
 and r.status in ('reserved','sent','delivered') and m.billing_billable=false
 and (m.billing_type='free_entry_point' or m.billing_category='referral_conversion');
notify pgrst,'reload schema';
