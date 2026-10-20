-- A voucher may be forwarded more than once. Keep one actionable review per
-- account and transaction reference while retaining the duplicate rows for
-- audit and for any historical enrollment that already points at them.
ALTER TABLE public.payment_reviews
  ADD COLUMN operation_reference text,
  ADD COLUMN duplicate_of uuid REFERENCES public.payment_reviews(id) ON DELETE RESTRICT;

WITH normalized AS (
  SELECT
    id,
    account_id,
    nullif(
      regexp_replace(
        upper(coalesce(evidence #>> '{fields,transaction_reference}', '')),
        '[^0-9A-Z]',
        '',
        'g'
      ),
      ''
    ) AS operation_reference,
    first_value(id) OVER (
      PARTITION BY account_id,
        nullif(
          regexp_replace(
            upper(coalesce(evidence #>> '{fields,transaction_reference}', '')),
            '[^0-9A-Z]',
            '',
            'g'
          ),
          ''
        )
      ORDER BY created_at, id
    ) AS canonical_id
  FROM public.payment_reviews
), ranked AS (
  SELECT * FROM normalized WHERE operation_reference IS NOT NULL
)
UPDATE public.payment_reviews review
SET
  operation_reference = CASE WHEN review.id = ranked.canonical_id THEN ranked.operation_reference ELSE NULL END,
  duplicate_of = CASE WHEN review.id = ranked.canonical_id THEN NULL ELSE ranked.canonical_id END
FROM ranked
WHERE review.id = ranked.id;

CREATE UNIQUE INDEX payment_reviews_account_operation
  ON public.payment_reviews(account_id, operation_reference)
  WHERE operation_reference IS NOT NULL;
CREATE INDEX payment_reviews_duplicate_of
  ON public.payment_reviews(duplicate_of)
  WHERE duplicate_of IS NOT NULL;

CREATE OR REPLACE FUNCTION crm_private.normalize_payment_operation(evidence jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT nullif(
    regexp_replace(
      upper(coalesce(evidence #>> '{fields,transaction_reference}', '')),
      '[^0-9A-Z]',
      '',
      'g'
    ),
    ''
  );
$$;
REVOKE ALL ON FUNCTION crm_private.normalize_payment_operation(jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION crm_private.set_payment_operation_reference()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  NEW.operation_reference = crm_private.normalize_payment_operation(NEW.evidence);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION crm_private.set_payment_operation_reference() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER payment_review_operation_reference
BEFORE INSERT ON public.payment_reviews
FOR EACH ROW EXECUTE FUNCTION crm_private.set_payment_operation_reference();

CREATE OR REPLACE FUNCTION crm_private.create_payment_review(target_message uuid, referring_user uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  m record;
  adviser record;
  result_id uuid;
  operation text;
BEGIN
  SELECT msg.*, c.account_id,c.contact_id,c.assigned_agent_id INTO m
    FROM public.messages msg JOIN public.conversations c ON c.id=msg.conversation_id
    WHERE msg.id=target_message AND msg.content_type='image' AND msg.sender_type='customer';
  IF NOT FOUND THEN RAISE EXCEPTION 'Inbound image not found'; END IF;

  operation := crm_private.normalize_payment_operation(coalesce(m.image_analysis, '{}'));
  IF operation IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(m.account_id::text || ':' || operation, 0));
    SELECT id INTO result_id
    FROM public.payment_reviews
    WHERE account_id = m.account_id
      AND operation_reference = operation
      AND duplicate_of IS NULL
    ORDER BY created_at, id
    LIMIT 1;
    IF result_id IS NOT NULL THEN RETURN result_id; END IF;
  END IF;

  SELECT full_name,nickname,area INTO adviser FROM public.profiles
    WHERE user_id=coalesce(referring_user,m.assigned_agent_id) AND account_id=m.account_id;
  INSERT INTO public.payment_reviews(account_id,message_id,conversation_id,contact_id,origin,source_area,source_adviser,evidence,media_url,created_at)
    VALUES(m.account_id,m.id,m.conversation_id,m.contact_id,
      CASE WHEN referring_user IS NULL THEN 'WHATSAPP' ELSE 'DERIVACION MANUAL' END,
      coalesce(nullif(upper(btrim(adviser.area)),''),'SIN AREA REGISTRADA'),
      coalesce(nullif(btrim(adviser.nickname),''),adviser.full_name),coalesce(m.image_analysis,'{}'),m.media_url,m.created_at)
    ON CONFLICT(message_id) DO NOTHING RETURNING id INTO result_id;
  IF result_id IS NULL THEN SELECT id INTO result_id FROM public.payment_reviews WHERE message_id=target_message; END IF;
  RETURN result_id;
END;
$$;
REVOKE ALL ON FUNCTION crm_private.create_payment_review(uuid,uuid) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
