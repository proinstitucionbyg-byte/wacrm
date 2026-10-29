// SQL-only integration checks. Uses a temporary PostgreSQL engine and fictitious contacts.
import { PGlite } from '../../output/multichannel-verification/node_modules/@electric-sql/pglite/dist/index.js';
import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const db = new PGlite();
const accountId = randomUUID(), ownerId = randomUUID(), otherAccountId = randomUUID();
let workerId, otherWorkerId;

before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.accounts(id uuid primary key, owner_user_id uuid not null);
    create table public.multichannel_workers(
      id uuid primary key default gen_random_uuid(), account_id uuid not null references public.accounts(id),
      name text not null, token_hash text not null, enabled boolean not null default true,
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
      last_customer_message_at timestamptz, automation_enabled boolean not null default true,
      ai_enabled boolean not null default true, ai_autoreply_disabled boolean not null default false,
      automation_disabled_at timestamptz, updated_at timestamptz not null default now(), unique(account_id,contact_id));
    create table public.messages(
      id uuid primary key default gen_random_uuid(), conversation_id uuid not null references public.conversations(id),
      sender_type text not null check(sender_type in ('customer','agent','bot')), content_type text not null
        check(content_type in ('text','image','video','document','audio','location','template','interactive')),
      content_text text, message_id text, status text not null check(status in ('sending','sent','delivered','read','failed')),
      created_at timestamptz not null default now(), billing_status text check(billing_status in ('free','paid','unknown')));
    insert into public.accounts(id,owner_user_id) values ('${accountId}','${ownerId}'),('${otherAccountId}','${randomUUID()}');`);
  await db.exec(await readFile(new URL('../../supabase/migrations/20261029151930_whatsapp_session_inbound_bridge.sql', import.meta.url), 'utf8'));
  const rows = await db.query(`insert into public.multichannel_workers(account_id,name,token_hash)
    values ($1,'Laptop principal',repeat('a',64)),($2,'Otra cuenta',repeat('b',64)) returning id`, [accountId, otherAccountId]);
  [workerId, otherWorkerId] = rows.rows.map(row => row.id);
  await db.query(`insert into public.multichannel_whatsapp_session_lines(account_id,line_key,worker_id,linked_phone,paused)
    values ($1,'WA-line-1',$2,'51911111111',false),($1,'WA-line-2',$2,'51933333333',false)`, [accountId, workerId]);
});
after(() => db.close());
beforeEach(async () => {
  await db.exec(`reset role; delete from public.whatsapp_session_inbound_receipts; delete from public.messages;
    delete from public.conversations; delete from public.contacts;
    update public.multichannel_whatsapp_session_lines set paused=false;`);
});

async function record(providerMessageId = 'provider-message-1', occurredAt = new Date().toISOString(), contentText = 'Hola desde sesión local') {
  return (await db.query(`select public.record_whatsapp_session_inbound($1,$2,$3,$4,$5,$6,$7,$8) as result`, [
    workerId, 'WA-line-1', '51911111111', providerMessageId, '51922222222',
    occurredAt, 'text', contentText,
  ])).rows[0].result;
}

test('stores one channel-tagged inbound per event and enables CRM automation for a new session chat', async () => {
  const first = await record();
  assert.equal(first, 'recorded');
  const repeat = await db.query('select public.record_whatsapp_session_inbound($1,$2,$3,$4,$5,$6,$7,$8) as result', [
    workerId,'WA-line-1','51911111111','provider-message-1','51922222222',new Date().toISOString(),'text','Hola desde sesión local',
  ]);
  assert.equal(repeat.rows[0].result, 'duplicate');
  const rows = await db.query(`select c.phone_normalized, c.channel, v.unread_count,v.automation_enabled,v.ai_enabled,
      v.last_customer_message_at is not null as customer_clock, m.sender_type,m.content_text,m.status,m.billing_status,m.whatsapp_session_line_key,
      r.contact_created,r.is_first_inbound,r.previous_inbound_at
    from public.contacts c join public.conversations v on v.contact_id=c.id
    join public.messages m on m.conversation_id=v.id
    join public.whatsapp_session_inbound_receipts r on r.message_row_id=m.id`);
  assert.deepEqual(rows.rows, [{ phone_normalized:'51922222222',channel:'whatsapp',unread_count:1,
    automation_enabled:true,ai_enabled:true,customer_clock:true,sender_type:'customer',
    content_text:'Hola desde sesión local',status:'delivered',billing_status:null,whatsapp_session_line_key:'WA-line-1',
    contact_created:true,is_first_inbound:true,previous_inbound_at:null }]);
});

test('receipt preserves the prior inbound time needed by the shared CRM dispatcher', async () => {
  const firstAt=new Date(Date.now()-5000).toISOString(),secondAt=new Date(Date.now()-1000).toISOString();
  assert.equal(await record('provider-first',firstAt,'Hola'), 'recorded');
  assert.equal(await record('provider-second',secondAt,'Quiero información'), 'recorded');
  const receipts=await db.query(`select provider_message_id,contact_created,is_first_inbound,previous_inbound_at
    from public.whatsapp_session_inbound_receipts order by created_at,provider_message_id`);
  assert.deepEqual(receipts.rows.map(row=>({
    provider_message_id:row.provider_message_id,contact_created:row.contact_created,
    is_first_inbound:row.is_first_inbound,previous_inbound_at:row.previous_inbound_at?.toISOString() ?? null,
  })),[
    {provider_message_id:'provider-first',contact_created:true,is_first_inbound:true,previous_inbound_at:null},
    {provider_message_id:'provider-second',contact_created:false,is_first_inbound:false,previous_inbound_at:firstAt},
  ]);
});

test('preserves automation and AI settings that the owner enabled on an existing conversation', async () => {
  const contact = (await db.query(`insert into public.contacts(account_id,user_id,phone,name,channel)
    values ($1,$2,'51922222222','Estudiante','whatsapp') returning id`, [accountId, ownerId])).rows[0];
  await db.query(`insert into public.conversations(account_id,user_id,contact_id,automation_enabled,ai_enabled,ai_autoreply_disabled)
    values ($1,$2,$3,true,true,false)`, [accountId, ownerId, contact.id]);
  assert.equal(await record(), 'recorded');
    const conversation = (await db.query(`select automation_enabled,ai_enabled,ai_autoreply_disabled
    from public.conversations where contact_id=$1`, [contact.id])).rows[0];
  assert.deepEqual(conversation, { automation_enabled: true, ai_enabled: true, ai_autoreply_disabled: false });
});

test('does not accept a line binding from another worker, wrong phone, or paused line', async () => {
  const wrongWorker = await db.query(`select public.record_whatsapp_session_inbound($1,$2,$3,$4,$5,$6,$7,$8) as result`, [
    otherWorkerId,'WA-line-1','51911111111','event-x','51922222223',new Date().toISOString(),'text','Hola',
  ]);
  assert.equal(wrongWorker.rows[0].result, 'paused_or_unbound');
  const wrongPhone = await db.query(`select public.record_whatsapp_session_inbound($1,$2,$3,$4,$5,$6,$7,$8) as result`, [
    workerId,'WA-line-1','51999999999','event-y','51922222223',new Date().toISOString(),'text','Hola',
  ]);
  assert.equal(wrongPhone.rows[0].result, 'paused_or_unbound');
  await db.query("update public.multichannel_whatsapp_session_lines set paused=true where line_key='WA-line-1'");
  assert.equal(await record(), 'paused_or_unbound');
  assert.equal((await db.query('select count(*)::int as count from public.messages')).rows[0].count, 0);
});

test('stores an explicit placeholder for an empty text event without billing evidence', async () => {
  const invalid = await db.query(`select public.record_whatsapp_session_inbound($1,$2,$3,$4,$5,$6,$7,$8) as result`, [
    workerId,'WA-line-1','51911111111','event-z','51922222224',new Date().toISOString(),'text','',
  ]);
  assert.equal(invalid.rows[0].result, 'recorded');
  const message = await db.query('select content_type,content_text,billing_status from public.messages');
  assert.deepEqual(message.rows, [{ content_type:'text',content_text:'[Mensaje recibido desde sesión WhatsApp]',billing_status:null }]);
});

test('browser roles cannot inspect session mappings or invoke the intake writer', async () => {
  for (const role of ['anon','authenticated']) {
    await db.exec(`set role ${role}`);
    await assert.rejects(db.query('select * from public.multichannel_whatsapp_session_lines'), /permission denied/);
    await assert.rejects(db.query('select * from public.whatsapp_session_inbound_receipts'), /permission denied/);
    await assert.rejects(db.query(`select public.record_whatsapp_session_inbound($1,$2,$3,$4,$5,$6,$7,$8)`, [
      workerId,'WA-line-1','51911111111','forbidden','51922222225',new Date().toISOString(),'text','Privado',
    ]), /permission denied/);
    await db.exec('reset role');
  }
});
