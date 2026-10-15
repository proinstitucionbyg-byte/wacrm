-- Only the account owner may change WhatsApp credentials/configuration.
-- Keep SELECT unchanged: authenticated send paths still read the encrypted
-- token under the existing account policy. The owner-only API guards remain.
DROP POLICY IF EXISTS whatsapp_config_insert ON public.whatsapp_config;
CREATE POLICY whatsapp_config_insert ON public.whatsapp_config FOR INSERT
  WITH CHECK (public.is_account_member(account_id, 'owner'));

DROP POLICY IF EXISTS whatsapp_config_update ON public.whatsapp_config;
CREATE POLICY whatsapp_config_update ON public.whatsapp_config FOR UPDATE
  USING (public.is_account_member(account_id, 'owner'))
  WITH CHECK (public.is_account_member(account_id, 'owner'));

DROP POLICY IF EXISTS whatsapp_config_delete ON public.whatsapp_config;
CREATE POLICY whatsapp_config_delete ON public.whatsapp_config FOR DELETE
  USING (public.is_account_member(account_id, 'owner'));
