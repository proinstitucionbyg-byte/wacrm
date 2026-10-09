-- Store a private, structured reading of images sent by contacts.
-- The existing messages RLS continues to scope these fields to the
-- same account members who can already read the message itself.
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS image_analysis jsonb;

-- Vision calls use the same BYO provider key and must appear in the
-- existing token-usage totals rather than disappearing from billing data.
ALTER TABLE public.ai_usage_log
  DROP CONSTRAINT IF EXISTS ai_usage_log_mode_check;

ALTER TABLE public.ai_usage_log
  ADD CONSTRAINT ai_usage_log_mode_check
  CHECK (mode IN ('auto_reply', 'draft', 'image_analysis'));
