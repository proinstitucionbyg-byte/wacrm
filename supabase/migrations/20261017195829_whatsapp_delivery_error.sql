ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS delivery_error jsonb;
COMMENT ON COLUMN public.messages.delivery_error IS 'Meta delivery failure code and explanation, captured from the signed WhatsApp status webhook.';
