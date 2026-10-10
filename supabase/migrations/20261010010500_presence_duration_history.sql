CREATE TABLE public.member_presence_intervals (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL CHECK(status IN ('online','away')),
  started_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  ended_at timestamptz
);
CREATE UNIQUE INDEX presence_one_open_interval ON public.member_presence_intervals(user_id) WHERE ended_at IS NULL;
CREATE INDEX presence_intervals_account_time ON public.member_presence_intervals(account_id,started_at);
ALTER TABLE public.member_presence_intervals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.member_presence_intervals FROM anon,authenticated;
GRANT SELECT ON public.member_presence_intervals TO authenticated;
CREATE POLICY presence_history_admin_read ON public.member_presence_intervals FOR SELECT TO authenticated USING (
  EXISTS(SELECT 1 FROM public.profiles p WHERE p.user_id=auth.uid() AND p.account_id=member_presence_intervals.account_id AND p.account_role IN ('owner','admin'))
);
CREATE FUNCTION crm_private.record_presence_interval() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE previous public.member_presence_intervals;
BEGIN
  SELECT * INTO previous FROM public.member_presence_intervals WHERE user_id=NEW.user_id AND ended_at IS NULL FOR UPDATE;
  IF FOUND AND previous.status=NEW.status AND previous.account_id=NEW.account_id AND NEW.last_seen_at<=previous.last_seen_at+interval '75 seconds' THEN
    UPDATE public.member_presence_intervals SET last_seen_at=NEW.last_seen_at WHERE id=previous.id;
  ELSE
    IF previous.id IS NOT NULL THEN
      UPDATE public.member_presence_intervals SET ended_at=least(NEW.last_seen_at,previous.last_seen_at+interval '75 seconds') WHERE id=previous.id;
    END IF;
    INSERT INTO public.member_presence_intervals(account_id,user_id,status,started_at,last_seen_at) VALUES(NEW.account_id,NEW.user_id,NEW.status,NEW.last_seen_at,NEW.last_seen_at);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION crm_private.record_presence_interval() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER record_presence_interval AFTER INSERT OR UPDATE ON public.member_presence FOR EACH ROW EXECUTE FUNCTION crm_private.record_presence_interval();

CREATE FUNCTION public.member_presence_summary(p_from timestamptz,p_until timestamptz) RETURNS TABLE(user_id uuid,display_name text,area text,online_seconds bigint,away_seconds bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE account uuid;
BEGIN
  SELECT p.account_id INTO account FROM public.profiles p WHERE p.user_id=auth.uid() AND p.account_role IN ('owner','admin');
  IF account IS NULL THEN RAISE EXCEPTION 'Solo administracion' USING ERRCODE='42501'; END IF;
  IF p_from IS NULL OR p_until IS NULL OR p_from>=p_until OR p_until-p_from>interval '93 days' THEN RAISE EXCEPTION 'Periodo no valido'; END IF;
  RETURN QUERY SELECT p.user_id,coalesce(nullif(btrim(p.nickname),''),p.full_name,p.email,'MIEMBRO'),coalesce(p.area,''),
    coalesce(sum(extract(epoch FROM greatest(interval '0',least(coalesce(i.ended_at,least(now(),i.last_seen_at+interval '75 seconds')),p_until)-greatest(i.started_at,p_from)))) FILTER(WHERE i.status='online'),0)::bigint,
    coalesce(sum(extract(epoch FROM greatest(interval '0',least(coalesce(i.ended_at,least(now(),i.last_seen_at+interval '75 seconds')),p_until)-greatest(i.started_at,p_from)))) FILTER(WHERE i.status='away'),0)::bigint
    FROM public.profiles p LEFT JOIN public.member_presence_intervals i ON i.user_id=p.user_id AND i.account_id=account AND i.started_at<p_until AND coalesce(i.ended_at,i.last_seen_at+interval '75 seconds')>p_from
    WHERE p.account_id=account GROUP BY p.user_id,p.nickname,p.full_name,p.email,p.area ORDER BY p.full_name;
END $$;
REVOKE ALL ON FUNCTION public.member_presence_summary(timestamptz,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.member_presence_summary(timestamptz,timestamptz) TO authenticated;
