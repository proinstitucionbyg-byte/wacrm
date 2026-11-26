#!/bin/sh
set -eu
sleep 180
while true; do
 age=$(docker exec personal_supabase-migration-export-db-1 psql -U supabase_admin -d migration_final_20261106_210600 -Atc "select coalesce(extract(epoch from now()-max(seen_at))::int,999999) from public.whatsapp_management_state where worker_id='83dc82a7-fe56-4f78-96e4-341b48b22351';" 2>/dev/null || true)
 case "$age" in ''|*[!0-9]*) sleep 30; continue;; esac
 if [ "$age" -gt 180 ]; then
  echo "WhatsApp heartbeat stale; restarting only existing worker"
  docker restart -t 30 personal_supabase-migration-export-whatsapp-worker-1 || true
  sleep 300
 else
  sleep 30
 fi
done
