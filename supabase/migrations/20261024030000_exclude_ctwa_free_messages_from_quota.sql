-- Click-to-WhatsApp messages delivered inside the confirmed 72-hour free
-- entry window do not consume the monthly service-message allowance.
-- The first billing migration conservatively backfilled outbound messages;
-- remove only the rows that can now be proven covered by signed referral data.
DELETE FROM public.whatsapp_service_message_reservations r
USING public.messages m, public.conversations c
WHERE r.source_message_row_id = m.id
  AND m.conversation_id = c.id
  AND r.month_start = date_trunc('month', timezone('utc', now()))::date
  AND c.first_ad_referral_at IS NOT NULL
  AND (
    nullif(c.first_ad_referral->>'ctwa_clid', '') IS NOT NULL
    OR (
      lower(coalesce(c.first_ad_referral->>'source_type', '')) = 'ad'
      AND nullif(coalesce(c.first_ad_referral->>'source_id', c.first_ad_referral->>'ad_id'), '') IS NOT NULL
    )
  )
  AND m.created_at >= c.first_ad_referral_at
  AND m.created_at < c.first_ad_referral_at + interval '72 hours';
