// SQL-only integration checks. Runs both local migrations in temporary PostgreSQL.
import { PGlite } from '../../output/multichannel-verification/node_modules/@electric-sql/pglite/dist/index.js';
import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const db = new PGlite();
const accountId = randomUUID(), ownerId = randomUUID();
let workerId;
const lineKey = 'WA-outbound-1';

before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create table public.accounts(id uuid primary key, owner_user_id uuid not null);
    create table public.profiles(user_id uuid primary key references auth.users(id),account_id uuid,account_role text);
    create table public.multichannel_workers(
      id uuid primary key default gen_random_uuid(), account_id uuid not null references public.accounts(id),
      name text not null, token_hash text not null, enabled boolean not null default true, last_seen_at timestamptz,
      unique(account_id,id));
    create table public.contacts(
      id uuid primary key default gen_random_uuid(), account_id uuid not null references public.accounts(id),
      user_id uuid not null, phone text not null, name text, channel text,
      phone_normalized text generated always as (regexp_replace(phone,'[^0-9]','','g')) stored);
    create unique index contacts_phone_unique on public.contacts(account_id,phone_normalized) where phone_normalized<>'';
    create table public.conversations(
      id uuid primary key default gen_random_uuid(), account_id uuid not null references public.accounts(id),
      user_id uuid not null, contact_id uuid not null references public.contacts(id), status text not null default 'open',
      unread_count integer default 0, last_message_text text, last_message_at timestamptz,
      last_customer_message_at timestamptz, last_human_message_at timestamptz,
      automation_enabled boolean not null default true, ai_enabled boolean not null default true,
      ai_autoreply_disabled boolean not null default false, automation_disabled_at timestamptz,
      updated_at timestamptz not null default now(), unique(account_id,contact_id));
    create table public.messages(
      id uuid primary key default gen_random_uuid(), conversation_id uuid not null references public.conversations(id),
      sender_type text not null check(sender_type in ('customer','agent','bot')), content_type text not null
        check(content_type in ('text','image','video','document','audio','location','template','interactive')),
      sender_id uuid, content_text text, message_id text, status text not null check(status in ('sending','sent','delivered','read','failed')),
      created_at timestamptz not null default now(), billing_status text check(billing_status in ('free','paid','unknown')));
    create table public.flow_runs(account_id uuid,contact_id uuid,status text,ended_at timestamptz,end_reason text);
    insert into public.accounts(id,owner_user_id) values ('${accountId}','${ownerId}');`);
  await db.query(`insert into auth.users(id) values($1)`, [ownerId]);
  await db.query(`insert into public.profiles(user_id,account_id,account_role) values($1,$2,'owner')`, [ownerId,accountId]);
  await db.exec(await readFile(new URL('../../supabase/migrations/20261029151930_whatsapp_session_inbound_bridge.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../../supabase/migrations/20261029151956_whatsapp_session_outbound_queue.sql', import.meta.url), 'utf8'));
  const result = await db.query(`insert into public.multichannel_workers(account_id,name,token_hash)
    values ($1,'Laptop de prueba',repeat('c',64)) returning id`, [accountId]);
  workerId = result.rows[0].id;
  await db.query(`insert into public.multichannel_whatsapp_session_lines(account_id,line_key,worker_id,linked_phone,paused)
    values ($1,$2,$3,'51911111111',false)`, [accountId,lineKey,workerId]);
});

after(() => db.close());
beforeEach(async () => {
  await db.exec(`reset role; delete from public.whatsapp_session_outbound_jobs; delete from public.whatsapp_session_inbound_receipts;
    delete from public.messages; delete from public.conversations; delete from public.contacts;
    update public.multichannel_whatsapp_session_lines set paused=false;`);
});

async function setupInbound({ humanAt = null } = {}) {
  await db.query(`select public.record_whatsapp_session_inbound($1,$2,$3,$4,$5,$6,$7,$8)`, [
    workerId,lineKey,'51911111111','inbound-provider-1','51922222222',new Date().toISOString(),'text','Hola',
  ]);
  await db.query(`update public.conversations set automation_enabled=true,last_human_message_at=$1 where account_id=$2`, [humanAt,accountId]);
  const row = await db.query(`select id from public.conversations where account_id=$1`, [accountId]);
  return row.rows[0].id;
}

async function enqueue(conversationId, dedupKey = 'automation:welcome:inbound-1') {
  return (await db.query(`select public.enqueue_whatsapp_session_text($1,$2,$3,$4,$5,$6) as result`, [
    accountId,conversationId,lineKey,'inbound-provider-1','Respuesta desde la sesión',dedupKey,
  ])).rows[0].result;
}

async function enqueueManual(conversationId, dedupKey = 'manual:reply-1') {
  return (await db.query(`select public.enqueue_whatsapp_session_manual_text($1,$2,$3,$4,$5,$6) as result`, [
    accountId,conversationId,lineKey,ownerId,'Respuesta de la asesora',dedupKey,
  ])).rows[0].result;
}

async function step(action, job = {}, state = null, provider = null) {
  return (await db.query(`select public.whatsapp_session_outbound_step($1,$2,$3,$4,$5,$6,$7) as result`, [
    workerId,lineKey,action,job.job_id ?? job.id ?? null,job.claim_token ?? null,state,provider,
  ])).rows[0].result;
}

test('enqueues an idempotent text job and keeps its Inbox message linked', async () => {
  const conversationId = await setupInbound();
  const first = await enqueue(conversationId);
  const duplicate = await enqueue(conversationId);
  assert.equal(first.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.job_id, first.job_id);
  assert.equal(duplicate.message_id, first.message_id);
  const rows = await db.query(`select j.status,m.status as message_status,m.sender_type,m.billing_status,m.message_id,
      c.last_message_text from public.whatsapp_session_outbound_jobs j
    join public.messages m on m.id=j.message_row_id join public.conversations c on c.id=j.conversation_id`);
  assert.deepEqual(rows.rows, [{ status:'queued',message_status:'sending',sender_type:'bot',billing_status:null,
    message_id:first.message_id,last_message_text:'Respuesta desde la sesión' }]);
});

test('worker claims, revalidates, then records accepted without duplicating delivery', async () => {
  const conversationId = await setupInbound();
  await enqueue(conversationId);
  const job = await step('claim');
  assert.equal(job.status, 'claimed');
  assert.equal(await step('claim'), null, 'an active dispatch must never be returned to another poller');
  const permit = await step('authorize', job);
  assert.equal(permit.allowed, true);
  assert.equal(permit.chat_id, '51922222222@c.us');
  const repeatedPermit = await step('authorize', job);
  assert.equal(repeatedPermit.allowed, true);
  const saved = await step('record', job, 'accepted', 'provider-out-1');
  assert.equal(saved.recorded, true);
  assert.equal(saved.status, 'accepted');
  assert.equal((await db.query('select message_id from public.messages where message_id=$1', [`waweb-job:${job.id}`])).rows.length, 0);
  assert.equal((await db.query("select message_id from public.messages where conversation_id=$1 and sender_type='bot' order by created_at desc limit 1", [conversationId])).rows[0].message_id, 'provider-out-1');
  const duplicateRecord = await step('record', job, 'delivered', 'provider-out-1');
  assert.equal(duplicateRecord, null);
  assert.equal((await db.query('select status from public.messages where message_id=$1', ['provider-out-1'])).rows[0].status, 'sent');
});

test('a recent human pause cancels the claimed send before WhatsApp dispatch', async () => {
  const conversationId = await setupInbound();
  await enqueue(conversationId);
  const job = await step('claim');
  await db.query('update public.conversations set last_human_message_at=now() where id=$1', [conversationId]);
  const permit = await step('authorize', job);
  assert.deepEqual(permit, { allowed: false });
  assert.equal((await db.query('select status from public.whatsapp_session_outbound_jobs')).rows[0].status, 'cancelled');
});

test('manual Inbox text stays attributed to the human and can send after CRM automations are paused', async () => {
  const conversationId = await setupInbound({ humanAt: new Date().toISOString() });
  const queued = await enqueueManual(conversationId);
  const again = await enqueueManual(conversationId);
  assert.equal(queued.duplicate, false);
  assert.equal(again.duplicate, true);
  assert.equal(again.message_row_id, queued.message_row_id);
  const row = await db.query(`select m.sender_type,m.sender_id,m.content_text,c.automation_enabled,c.ai_enabled,
    c.last_human_message_at,j.sender_type as job_sender from public.messages m
    join public.whatsapp_session_outbound_jobs j on j.message_row_id=m.id
    join public.conversations c on c.id=m.conversation_id where m.id=$1`, [queued.message_row_id]);
  assert.deepEqual(row.rows[0], {
    sender_type:'agent',sender_id:ownerId,content_text:'Respuesta de la asesora',
    automation_enabled:false,ai_enabled:false,last_human_message_at:row.rows[0].last_human_message_at,
    job_sender:'agent',
  });
  const job = await step('claim');
  assert.equal(job.status, 'claimed');
  await db.query('delete from public.profiles where user_id=$1', [ownerId]);
  assert.deepEqual(await step('authorize', job), { allowed:false });
});

test('a newer customer message prevents a stale queued reply from being sent', async () => {
  const conversationId = await setupInbound();
  await enqueue(conversationId);
  await db.query(`insert into public.messages(conversation_id,sender_type,content_type,content_text,status)
    values ($1,'customer','text','Nuevo mensaje','delivered')`, [conversationId]);
  await assert.rejects(enqueue(conversationId, 'stale-key'), /Inbound message is no longer the latest customer message/);
});

test('a lost dispatch lease is marked for review and is never automatically reclaimed', async () => {
  const conversationId = await setupInbound();
  await enqueue(conversationId);
  const job = await step('claim');
  await step('authorize', job);
  await db.query(`update public.whatsapp_session_outbound_jobs set lease_until=now()-interval '1 second' where id=$1`, [job.id]);
  const next = await step('claim');
  assert.equal(next, null);
  assert.equal((await db.query('select status from public.whatsapp_session_outbound_jobs')).rows[0].status, 'needs_review');
});

test('authenticated browser clients cannot read or drive the outbound queue', async () => {
  await db.exec('set role authenticated');
  await assert.rejects(db.query('select * from public.whatsapp_session_outbound_jobs'), /permission denied/);
  await assert.rejects(db.query(`select public.whatsapp_session_outbound_step($1,$2,'claim')`, [workerId,lineKey]), /permission denied/);
});
