BEGIN;
CREATE TEMP TABLE chat_fixture AS
SELECT account_id, array_agg(user_id ORDER BY user_id) AS users, NULL::uuid AS room
FROM public.profiles WHERE account_role IN ('owner','admin','agent')
GROUP BY account_id HAVING count(*)>=3 LIMIT 1;
GRANT SELECT,UPDATE ON chat_fixture TO authenticated;
SELECT set_config('request.jwt.claim.sub',(SELECT users[1]::text FROM chat_fixture),true);
SET LOCAL ROLE authenticated;
UPDATE chat_fixture SET room=public.create_team_thread(ARRAY[users[2]],NULL);
DO $$
DECLARE f record; reused uuid;
BEGIN
 SELECT * INTO f FROM chat_fixture;
 reused=public.create_team_thread(ARRAY[f.users[2]],NULL);
 IF reused<>f.room THEN RAISE EXCEPTION 'Duplicate direct thread'; END IF;
 INSERT INTO public.team_messages(id,thread_id,account_id,sender_id,body)
 VALUES('22222222-2222-4222-8222-222222222222',f.room,f.account_id,f.users[1],E'PRUEBA CON ROLLBACK\nSEGUNDA LINEA');
 IF (SELECT count(*) FROM public.team_messages WHERE thread_id=f.room)<>1 THEN RAISE EXCEPTION 'Member cannot read'; END IF;
 BEGIN
  INSERT INTO public.team_messages(id,thread_id,account_id,sender_id,body)
  VALUES(gen_random_uuid(),f.room,f.account_id,f.users[2],'FORGED SENDER');
  RAISE EXCEPTION 'Forged sender accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM public.create_team_thread(ARRAY['33333333-3333-4333-8333-333333333333'::uuid],NULL);
  RAISE EXCEPTION 'Unknown participant accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DO $$
BEGIN
 IF (SELECT count(*) FROM public.notifications n JOIN chat_fixture f ON n.team_thread_id=f.room WHERE n.type='team_message' AND n.user_id=f.users[2])<>1 THEN RAISE EXCEPTION 'Notification missing'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub',(SELECT users[3]::text FROM chat_fixture),true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE f record;
BEGIN
 SELECT * INTO f FROM chat_fixture;
 IF EXISTS(SELECT 1 FROM public.team_threads WHERE id=f.room) OR EXISTS(SELECT 1 FROM public.team_messages WHERE thread_id=f.room) OR EXISTS(SELECT 1 FROM public.team_thread_members WHERE thread_id=f.room) THEN RAISE EXCEPTION 'Nonparticipant can read'; END IF;
 BEGIN
  INSERT INTO public.team_messages(id,thread_id,account_id,sender_id,body)
  VALUES(gen_random_uuid(),f.room,f.account_id,f.users[3],'OUTSIDER');
  RAISE EXCEPTION 'Nonparticipant can send';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'PASS: member read, duplicate thread reuse, notification, forged sender denied, unknown member denied, outsider read/send denied; all fixtures rolled back' AS result;
