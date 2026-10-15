-- Each Supabase Auth session gets one audit row. A heartbeat only proves that
-- the CRM tab was recently open; it cannot locate a closed device.
CREATE TABLE public.member_session_audit (
  session_id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  user_agent text,
  reported_ip inet,
  latitude double precision,
  longitude double precision,
  accuracy_m double precision,
  location_seen_at timestamptz,
  location_declined_at timestamptz,
  CONSTRAINT member_session_location_pair CHECK ((latitude IS NULL) = (longitude IS NULL)),
  CONSTRAINT member_session_latitude CHECK (latitude BETWEEN -90 AND 90),
  CONSTRAINT member_session_longitude CHECK (longitude BETWEEN -180 AND 180),
  CONSTRAINT member_session_accuracy CHECK (accuracy_m >= 0)
);

CREATE INDEX member_session_audit_account_seen
  ON public.member_session_audit(account_id, last_seen_at DESC);

ALTER TABLE public.member_session_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.member_session_audit FROM anon, authenticated;
GRANT SELECT ON public.member_session_audit TO authenticated;

-- Precise coordinates and device metadata belong to the CEO only.
CREATE POLICY member_session_owner_read ON public.member_session_audit
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.account_id = member_session_audit.account_id
        AND p.account_role = 'owner'
    )
  );

CREATE FUNCTION public.touch_member_session(
  p_user_agent text,
  p_reported_ip inet DEFAULT NULL,
  p_latitude double precision DEFAULT NULL,
  p_longitude double precision DEFAULT NULL,
  p_accuracy_m double precision DEFAULT NULL,
  p_location_declined boolean DEFAULT false
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_session_id uuid;
  v_account_id uuid;
BEGIN
  v_session_id := nullif(auth.jwt()->>'session_id', '')::uuid;
  IF auth.uid() IS NULL OR v_session_id IS NULL THEN
    RAISE EXCEPTION 'Authenticated session required' USING ERRCODE = '42501';
  END IF;

  SELECT p.account_id INTO v_account_id
  FROM public.profiles p WHERE p.user_id = auth.uid();
  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'Account required' USING ERRCODE = '42501';
  END IF;

  IF (p_latitude IS NULL) <> (p_longitude IS NULL)
     OR (p_latitude IS NOT NULL AND (p_latitude NOT BETWEEN -90 AND 90
       OR p_longitude NOT BETWEEN -180 AND 180
       OR p_accuracy_m IS NULL OR p_accuracy_m < 0)) THEN
    RAISE EXCEPTION 'Invalid location';
  END IF;

  INSERT INTO public.member_session_audit (
    session_id, account_id, user_id, user_agent, reported_ip,
    latitude, longitude, accuracy_m, location_seen_at, location_declined_at
  ) VALUES (
    v_session_id, v_account_id, auth.uid(), left(p_user_agent, 500), p_reported_ip,
    p_latitude, p_longitude, p_accuracy_m,
    CASE WHEN p_latitude IS NOT NULL THEN now() ELSE NULL END,
    CASE WHEN p_location_declined THEN now() ELSE NULL END
  )
  ON CONFLICT (session_id) DO UPDATE SET
    last_seen_at = now(),
    user_agent = EXCLUDED.user_agent,
    reported_ip = COALESCE(EXCLUDED.reported_ip, member_session_audit.reported_ip),
    latitude = COALESCE(EXCLUDED.latitude, member_session_audit.latitude),
    longitude = COALESCE(EXCLUDED.longitude, member_session_audit.longitude),
    accuracy_m = COALESCE(EXCLUDED.accuracy_m, member_session_audit.accuracy_m),
    location_seen_at = CASE WHEN EXCLUDED.latitude IS NOT NULL THEN now()
      ELSE member_session_audit.location_seen_at END,
    location_declined_at = COALESCE(EXCLUDED.location_declined_at, member_session_audit.location_declined_at);

  IF p_location_declined THEN
    INSERT INTO public.notifications(account_id,user_id,type,title,body,target_url,dedup_key)
      SELECT v_account_id,p.user_id,'system_notice',
        'ASESOR SIN UBICACIÓN COMPARTIDA',
        coalesce(nullif(actor.full_name,''),'Un integrante') || ' ingresó al CRM sin compartir ubicación. La sesión sigue disponible en Configuración → Seguridad.',
        '/settings', 'location-declined:' || v_session_id::text
      FROM public.profiles p
      JOIN public.profiles actor ON actor.user_id=auth.uid()
      WHERE p.account_id=v_account_id AND p.account_role='owner'
        AND p.user_id <> auth.uid()
      ON CONFLICT DO NOTHING;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.touch_member_session(text, inet, double precision, double precision, double precision, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.touch_member_session(text, inet, double precision, double precision, double precision, boolean)
  TO authenticated;
