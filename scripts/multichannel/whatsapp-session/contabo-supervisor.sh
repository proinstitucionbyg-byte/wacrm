#!/bin/sh
set -eu
W=personal_supabase-migration-export-whatsapp-worker-1
V=personal_supabase-migration-export_worker-sessions-final-20261106
R=personal_supabase-migration-export_worker-runtime-final
sleep 30
while true; do
 age=$(docker exec personal_supabase-migration-export-db-1 psql -U supabase_admin -d migration_final_20261106_210600 -Atc "select coalesce(extract(epoch from now()-max(seen_at))::int,999999) from public.whatsapp_management_state where worker_id='83dc82a7-fe56-4f78-96e4-341b48b22351';" 2>/dev/null || true)
 case "$age" in ''|*[!0-9]*) sleep 30; continue;; esac
 state=$(docker inspect "$W" --format '{{.State.Status}}' 2>/dev/null || true)
 if [ "$age" -gt 180 ] || [ "$state" = restarting ] || [ "$state" = exited ]; then
  echo "Recovering stale executor; preserving profiles and message journals"
  docker stop -t 30 "$W" >/dev/null || { sleep 60; continue; }
  busy=false
  for cid in $(docker ps -q --filter volume="$V"); do
   if docker inspect "$cid" --format '{{range .Mounts}}{{if .RW}}{{println .Name}}{{end}}{{end}}' | grep -qx "$V"; then busy=true; fi
  done
  if [ "$busy" = true ]; then echo "Recovery blocked: another writer owns session volume"; sleep 60; continue; fi
  image=$(docker inspect "$W" --format '{{.Image}}')
  if docker run --rm --entrypoint node -v "$R:/runtime:ro" -v "$V:/app/output/multichannel-private/whatsapp-session" "$image" --input-type=module -e "import {archiveStoppedLocks} from '/runtime/recover-stopped-locks.mjs'; console.log(JSON.stringify(await archiveStoppedLocks('/app/output/multichannel-private/whatsapp-session',{exclusive:true})));"; then
   docker run --rm --entrypoint cat -v "$R:/runtime:ro" "$image" /runtime/crm-management-resilient.mjs > /tmp/crm-management.mjs
   docker cp /tmp/crm-management.mjs "$W:/app/scripts/multichannel/whatsapp-session/crm-management.mjs"
   if docker run --rm --entrypoint cat -v "$R:/runtime:ro" "$image" /runtime/adapter-resilient.mjs > /tmp/adapter.mjs; then
    docker cp /tmp/adapter.mjs "$W:/app/scripts/multichannel/whatsapp-session/adapter.mjs"
   fi
   docker start "$W" >/dev/null
  else echo "Recovery blocked: profile verification failed"; fi
  sleep 300
 else sleep 30
 fi
done
