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
  await db.exec('alter table public.messages add column interactive_payload jsonb;');
  await db.exec(await readFile(new URL('../../supabase/migrations/20261104111054_whatsapp_session_text_menus.sql', import.meta.url), 'utf8'));
  await db.exec('alter table public.messages add column source_referral jsonb;alter table public.conversations add column first_ad_referral jsonb;');
  await db.exec(await readFile(new URL('../../supabase/migrations/20261104162106_whatsapp_cloud_support_handoff.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../../supabase/migrations/20261104172431_whatsapp_session_outgoing_echo.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../../supabase/migrations/20261104174332_phone_echo_preserve_reactivation.sql', import.meta.url), 'utf8'));
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
    delete from public.whatsapp_support_routes;
    update public.multichannel_whatsapp_session_lines set paused=false,support_ready_at=null;`);
});

async function cloudSource(){
 const contact=(await db.query('insert into public.contacts(account_id,user_id,phone)values($1,$2,$3)returning id',[accountId,ownerId,'51933333333'])).rows[0].id;
 const conversation=(await db.query('insert into public.conversations(account_id,user_id,contact_id,automation_enabled)values($1,$2,$3,false)returning id',[accountId,ownerId,contact])).rows[0].id;
 await db.query("insert into public.messages(conversation_id,sender_type,content_type,content_text,message_id,status)values($1,'customer','text','Hola','wamid.cloud-test','delivered')",[conversation]);
 await db.query('insert into public.whatsapp_support_routes(account_id,enabled,line_order)values($1,true,$2)',[accountId,[lineKey]]);
 await db.query('update public.multichannel_whatsapp_session_lines set support_ready_at=now() where account_id=$1',[accountId]);return conversation;
}
async function supportOpening(conversation){return(await db.query('select public.enqueue_cloud_support_opening($1,$2,$3,$4,$5::jsonb)as result',[accountId,conversation,'wamid.cloud-test','Hola, ¿en qué podemos ayudarte?\n1. Cursos',JSON.stringify([{id:'existing-id',title:'Cursos'}])])).rows[0].result;}
test('Cloud first contact is sent through an available owner line without inventing a session inbound or billing reservation',async()=>{
 const conversation=await cloudSource(),first=await supportOpening(conversation),again=await supportOpening(conversation);assert.equal(first.state,'queued');assert.equal(first.job_id,again.job_id);
 assert.equal((await db.query('select count(*)::int as n from public.whatsapp_session_inbound_receipts')).rows[0].n,0);
 const job=await step('claim');assert.ok(job.cloud_support_source_id);const permit=await step('authorize',job);assert.equal(permit.inbound_source,'cloud_support');
 await step('record',job,'accepted','physical-support-provider');
 assert.equal((await db.query("select status from public.messages where message_id='physical-support-provider'")).rows[0].status,'sent');
});
test('Cloud support refuses ad conversations and preserves active human attention',async()=>{
 const conversation=await cloudSource();await db.query("update public.conversations set first_ad_referral=$1 where id=$2",[{source_type:'ad',source_id:'real-ad'},conversation]);
 assert.equal((await supportOpening(conversation)).handled,false);
 await db.query('update public.conversations set first_ad_referral=null,last_human_message_at=now() where id=$1',[conversation]);
 assert.equal((await supportOpening(conversation)).state,'human_active');assert.equal(await step('claim'),null);
});
test('Cloud support chooses the next configured available line and never an unconfigured one',async()=>{
 const conversation=await cloudSource();const alternate='WA-support-backup';
 await db.query('insert into public.multichannel_whatsapp_session_lines(account_id,line_key,worker_id,linked_phone,paused,support_ready_at)values($1,$2,$3,$4,false,now())',[accountId,alternate,workerId,'51944444444']);
 try{await db.query('update public.whatsapp_support_routes set line_order=$1 where account_id=$2',[[lineKey,alternate],accountId]);await db.query('update public.multichannel_whatsapp_session_lines set support_ready_at=null where line_key=$1',[lineKey]);
  const result=await supportOpening(conversation);assert.equal(result.line_key,alternate);
 }finally{await db.exec('delete from public.whatsapp_session_outbound_jobs;delete from public.messages;');await db.query('delete from public.multichannel_whatsapp_session_lines where line_key=$1',[alternate]);}
});
test('Cloud support fails closed when no ready line exists and browser roles cannot configure the routing',async()=>{
 const conversation=await cloudSource();await db.exec('update public.multichannel_whatsapp_session_lines set support_ready_at=null');assert.equal((await supportOpening(conversation)).state,'no_ready_line');
 await db.exec('set role authenticated');try{await assert.rejects(db.query('select * from public.whatsapp_support_routes'),/permission denied/);}finally{await db.exec('reset role');}
});
test('an expired claim on another paused line cannot hold every line of the worker',async()=>{
 const conversation=await setupInbound();await enqueue(conversation);const held=await step('claim');
 const backup='WA-release-test';await db.query('insert into public.multichannel_whatsapp_session_lines(account_id,line_key,worker_id,linked_phone,paused)values($1,$2,$3,$4,false)',[accountId,backup,workerId,'51955555555']);
 try{
  await db.query("update public.whatsapp_session_outbound_jobs set lease_until=now()-interval '1 minute' where id=$1",[held.id]);
  await db.query('update public.multichannel_whatsapp_session_lines set paused=true where line_key=$1',[lineKey]);
  await db.query('select public.whatsapp_session_outbound_step($1,$2,$3)',[workerId,backup,'claim']);
  assert.equal((await db.query('select status from public.whatsapp_session_outbound_jobs where id=$1',[held.id])).rows[0].status,'cancelled');
 }finally{await db.query('delete from public.multichannel_whatsapp_session_lines where line_key=$1',[backup]);}
});
test('actual provider acknowledgements update delivered and read without regressing or sending again',async()=>{
 const conversation=await setupInbound();await enqueue(conversation);const job=await step('claim');await step('authorize',job);await step('record',job,'accepted','provider-delivery-test');
 assert.equal(await step('ack',job,'delivered','wrong-provider'),null);
 assert.equal((await step('ack',job,'delivered','provider-delivery-test')).status,'delivered');
 assert.equal((await step('ack',job,'read','provider-delivery-test')).status,'read');
 assert.equal((await step('ack',job,'delivered','provider-delivery-test')).status,'read');
 assert.equal(await step('claim'),null);
});
async function phoneEcho(conversation,id='native-phone',text='Respuesta desde el teléfono',ack=2){return(await db.query('select public.record_whatsapp_session_phone_echo($1,$2,$3,$4,$5,$6,$7,$8,$9) as result',[workerId,lineKey,'51911111111','51922222222',id,new Date().toISOString(),'text',text,ack])).rows[0].result;}
test('a phone-written message reaches Inbox once, pauses the bot, and never creates a customer inbound',async()=>{
 const conversation=await setupInbound(),before=(await db.query('select count(*)::int n from public.whatsapp_session_inbound_receipts')).rows[0].n;
 const first=await phoneEcho(conversation),again=await phoneEcho(conversation);assert.equal(first.message_row_id,again.message_row_id);assert.equal(first.status,'delivered');
 assert.equal((await db.query('select automation_enabled from public.conversations where id=$1',[conversation])).rows[0].automation_enabled,false);
 assert.equal((await db.query('select count(*)::int n from public.whatsapp_session_inbound_receipts')).rows[0].n,before);
});
test('a later delivery ack cannot undo explicit bot reactivation',async()=>{
 const conversation=await setupInbound();await phoneEcho(conversation);
 await db.query('update public.conversations set automation_enabled=true,ai_enabled=true where id=$1',[conversation]);
 await phoneEcho(conversation,'native-phone','Respuesta desde el teléfono',3);
 assert.equal((await db.query('select automation_enabled from public.conversations where id=$1',[conversation])).rows[0].automation_enabled,true);
});
test('a real phone echo reconciles a unique uncertain job without sending it again',async()=>{
 const conversation=await setupInbound();await enqueue(conversation);const job=await step('claim');await step('authorize',job);await step('record',job,'needs_review');
 const echo=await phoneEcho(conversation,'native-proof','Respuesta desde la sesión',2);assert.equal(echo.matched_queue,true);assert.equal(echo.status,'delivered');
 assert.equal((await db.query('select provider_message_id,status from public.whatsapp_session_outbound_jobs where id=$1',[job.id])).rows[0].provider_message_id,'native-proof');
 assert.equal(await step('claim'),null);
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

async function queueMenu(conversationId){
 return(await db.query('select public.enqueue_whatsapp_session_text_menu($1,$2,$3,$4,$5,$6,$7::jsonb) as result',[
  accountId,conversationId,lineKey,'inbound-provider-1','Opciones\n1. Ventas\n2. Soporte','menu-demo',JSON.stringify([{id:'sales_existing_branch',title:'Ventas'},{id:'academic_existing_branch',title:'Soporte'}]),
 ])).rows[0].result;
}
async function incomingChoice(conversationId,id,text='2'){
 await db.query('select public.record_whatsapp_session_inbound($1,$2,$3,$4,$5,$6,$7,$8)',[workerId,lineKey,'51911111111',id,'51922222222',new Date(Date.now()+1000).toISOString(),'text',text]);
 return(await db.query('select message_row_id from public.whatsapp_session_inbound_receipts where provider_message_id=$1',[id])).rows[0].message_row_id;
}
async function resolveMenu(conversationId,inbound,worker=workerId){return(await db.query('select public.resolve_whatsapp_session_menu_reply($1,$2,$3,$4) as result',[worker,lineKey,conversationId,inbound])).rows[0].result;}

test('text menu maps a numeric reply to the original branch exactly once',async()=>{
 const conversation=await setupInbound();const original=await queueMenu(conversation),duplicate=await queueMenu(conversation);assert.equal(duplicate.job_id,original.job_id);
 const job=await step('claim');await step('authorize',job);await step('record',job,'accepted','provider-menu');
 const inbound=await incomingChoice(conversation,'menu-choice');assert.equal(await resolveMenu(conversation,inbound,randomUUID()),null);assert.deepEqual(await resolveMenu(conversation,inbound),{reply_id:'academic_existing_branch'});
 assert.deepEqual(await resolveMenu(conversation,inbound),{reply_id:'academic_existing_branch'});
 const repeated=await incomingChoice(conversation,'menu-choice-repeat','1');assert.equal(await resolveMenu(conversation,repeated),null);
});
test('an unsent or expired menu cannot select a branch and another worker cannot consume it',async()=>{
 const conversation=await setupInbound();await queueMenu(conversation);const inbound=await incomingChoice(conversation,'unsent-choice');assert.equal(await resolveMenu(conversation,inbound),null);
 assert.equal(await resolveMenu(conversation,inbound,randomUUID()),null);
 await db.query("update public.messages set interactive_payload=interactive_payload||jsonb_build_object('expires_at',now()-interval '1 second') where sender_type='bot'");
 assert.equal(await resolveMenu(conversation,inbound),null);
});
test('menu transition functions reject untrusted browser callers',async()=>{
 await db.exec('set role authenticated');await assert.rejects(db.query('select public.resolve_whatsapp_session_menu_reply($1,$2,$3,$4)',[workerId,lineKey,randomUUID(),randomUUID()]),/permission denied/);
 await assert.rejects(db.query('select public.enqueue_whatsapp_session_text_menu($1,$2,$3,$4,$5,$6,$7::jsonb)',[accountId,randomUUID(),lineKey,'inbound','Hola','key','[]']),/permission denied/);
});
test('even a provider-confirmed menu expires without selecting any branch',async()=>{
 const conversation=await setupInbound();await queueMenu(conversation);const job=await step('claim');await step('authorize',job);await step('record',job,'accepted','provider-expired-menu');
 await db.query("update public.messages set interactive_payload=interactive_payload||jsonb_build_object('expires_at',now()-interval '1 second') where sender_type='bot'");
 const inbound=await incomingChoice(conversation,'expired-choice');assert.equal(await resolveMenu(conversation,inbound),null);
});

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
