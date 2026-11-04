import{PGlite}from'../../output/multichannel-verification/node_modules/@electric-sql/pglite/dist/index.js';
import{readFile}from'node:fs/promises';import{randomUUID}from'node:crypto';import{before,after,beforeEach,test}from'node:test';import assert from'node:assert/strict';
const db=new PGlite(),account=randomUUID(),actor=randomUUID(),contact=randomUUID();let w1,w2;
before(async()=>{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create table accounts(id uuid primary key);create table profiles(user_id uuid primary key,account_id uuid,account_role text);
 create table contacts(id uuid primary key,account_id uuid,phone text,phone_normalized text);
 create table conversations(id uuid primary key default gen_random_uuid(),account_id uuid,user_id uuid,contact_id uuid,status text,assigned_agent_id uuid,automation_enabled boolean,ai_enabled boolean,ai_autoreply_disabled boolean,last_human_message_at timestamptz,last_message_text text,last_message_at timestamptz,updated_at timestamptz,unique(account_id,contact_id));
 create table messages(id uuid primary key default gen_random_uuid(),conversation_id uuid,sender_type text,content_type text,content_text text,message_id text,status text,created_at timestamptz,whatsapp_session_line_key text);`);
 for(const name of ['20261029151921_multichannel_worker_queue.sql','20261028173948_multichannel_sms_dispatch.sql'])await db.exec(await readFile(new URL('../../supabase/migrations/'+name,import.meta.url),'utf8'));
 await db.exec(`create table multichannel_whatsapp_session_lines(account_id uuid not null,line_key text not null,worker_id uuid not null,linked_phone text not null,paused boolean not null default false,primary key(account_id,line_key));`);
 await db.exec(await readFile(new URL('../../supabase/migrations/20261104073046_multichannel_live_campaigns.sql',import.meta.url),'utf8'));
});
after(()=>db.close());
beforeEach(async()=>{
 await db.exec('reset role;truncate multichannel_jobs,multichannel_campaigns,multichannel_whatsapp_session_lines,multichannel_sms_authorizations,multichannel_sms_authorization_events,multichannel_sms_bindings,multichannel_workers,multichannel_lines,messages,conversations,contacts,profiles,accounts cascade;');
 await db.query('insert into accounts values($1)',[account]);await db.query("insert into profiles values($1,$2,'owner')",[actor,account]);
 await db.query("insert into contacts values($1,$2,'51900000001','51900000001')",[contact,account]);
 const rows=(await db.query("insert into multichannel_workers(account_id,name,token_hash)values($1,'A',repeat('a',64)),($1,'B',repeat('b',64)) returning id",[account])).rows;
 [w1,w2]=rows.map(r=>r.id);
 await db.query("insert into multichannel_whatsapp_session_lines(account_id,line_key,worker_id,linked_phone)values($1,'WA-a',$2,'51900000002'),($1,'WA-b',$3,'51900000003')",[account,w1,w2]);
});
const input=(patch={})=>({request_id:randomUUID(),review_hash:'a'.repeat(64),name:'Aviso',purpose:'notice',body:'Texto ficticio',routes:[{channel:'whatsapp_support',line_key:'WA-a'},{channel:'whatsapp_support',line_key:'WA-b'}],run_at:new Date(Date.now()-60000).toISOString(),expires_at:new Date(Date.now()+3600000).toISOString(),interval_seconds:1,block_size:10,block_pause_seconds:0,recipients:[{contact_id:contact,permission_expires_at:new Date(Date.now()+7200000).toISOString(),evidence:'Permiso ficticio revisado'}],...patch});
const control=async(action,payload,who=actor)=>(await db.query('select multichannel_campaign_control($1,$2,$3,$4) as r',[account,who,action,JSON.stringify(payload)])).rows[0].r;
async function step(action,line='WA-a',job={},ready=true){return(await db.query('select multichannel_campaign_worker_step($1,$2,$3,$4,$5,$6,$7,$8,$9) as r',[line==='WA-a'?w1:w2,line,action,job.id??null,job.claim_token??null,ready,line==='WA-a'?'51900000002':'51900000003',job.result??null,job.provider??null])).rows[0].r;}
async function campaign(patch={}){const c=await control('create',input(patch));await control('activate',{campaign_id:c.id,review_hash:c.review_hash});return c;}
test('draft cannot send; review activates and repeated creation does not duplicate',async()=>{
 const plan=input(),c=await control('create',plan);await step('heartbeat');assert.equal(await step('claim'),null);
 assert.equal((await control('create',plan)).duplicate,true);
 await assert.rejects(control('create',{...plan,review_hash:'b'.repeat(64)}));
 await control('activate',{campaign_id:c.id,review_hash:c.review_hash});assert.equal((await step('claim')).campaign_id,c.id);
});
test('future campaign does not start and a paused one cannot be claimed',async()=>{
 const c=await campaign({run_at:new Date(Date.now()+600000).toISOString()});await step('heartbeat');assert.equal(await step('claim'),null);
 await control('pause',{campaign_id:c.id,value:true});assert.equal(await step('claim'),null);
});
test('selects first ready fallback and fences a pause between claim and start',async()=>{
 const c=await campaign();await step('heartbeat','WA-b');assert.equal(await step('claim','WA-a'),null);
 const j=await step('claim','WA-b');assert.equal(j.line_key,'WA-b');await control('pause',{campaign_id:c.id,value:true});
 assert.equal((await step('authorize','WA-b',j)).allowed,false);assert.equal((await db.query('select started_at from multichannel_jobs where id=$1',[j.id])).rows[0].started_at,null);
});
test('started uncertain work never moves to a second WhatsApp',async()=>{
 await campaign();await step('heartbeat');await step('heartbeat','WA-b');const j=await step('claim');assert.equal((await step('authorize','WA-a',j)).allowed,true);
 await db.query("update multichannel_jobs set lease_until=now()-interval '1 second' where id=$1",[j.id]);await step('heartbeat','WA-a',{},false);
 assert.equal(await step('claim','WA-b'),null);assert.equal((await db.query('select status from multichannel_jobs where id=$1',[j.id])).rows[0].status,'needs_review');
});
test('no available route creates an alert and preserves the pending work',async()=>{
 await campaign();assert.equal(await step('claim'),null);
 assert.equal((await db.query('select routing_alert,status from multichannel_jobs')).rows[0].routing_alert,'no_available_authorized_line');
});
test('records the actual provider result and never marks uncertainty delivered',async()=>{
 await campaign();await step('heartbeat');const j=await step('claim');await step('authorize','WA-a',j);
 assert.equal((await step('record','WA-a',{...j,result:'accepted',provider:'real-provider-key'})).recorded,true);
 const r=(await db.query('select status,provider_id from multichannel_jobs')).rows[0];assert.equal(r.status,'accepted');assert.equal(r.provider_id,'real-provider-key');
});
test('browser roles cannot access the campaign queue or its transitions',async()=>{
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(db.query('select * from multichannel_campaigns'));await assert.rejects(control('create',input()));await db.exec('reset role');}
 await assert.rejects(control('create',input(),randomUUID()));
});
test('actual block pauses remain enforced after the machine catches up with overdue work',async()=>{
 const second=randomUUID();await db.query("insert into contacts values($1,$2,'51900000004','51900000004')",[second,account]);
 const p=input({block_size:1,block_pause_seconds:60,run_at:new Date(Date.now()-3600000).toISOString()});p.recipients.push({...p.recipients[0],contact_id:second});await campaign(p);await step('heartbeat');
 const j=await step('claim');await step('authorize','WA-a',j);await step('record','WA-a',{...j,result:'accepted',provider:'first-provider'});
 assert.equal(await step('claim'),null);await db.query("update multichannel_jobs set started_at=now()-interval '61 seconds' where id=$1",[j.id]);assert.equal((await step('claim')).contact_id,second);
});
test('one hub may reserve work for distinct WhatsApp profiles in parallel',async()=>{
 await db.query("update multichannel_whatsapp_session_lines set worker_id=$1 where line_key='WA-b'",[w1]);w2=w1;
 await campaign();await campaign({routes:[{channel:'whatsapp_support',line_key:'WA-b'}]});await step('heartbeat');await step('heartbeat','WA-b');
 const a=await step('claim'),b=await step('claim','WA-b');assert.ok(a);assert.ok(b);assert.notEqual(a.id,b.id);
});
test('a confirmed provider ack updates the same CRM message without creating another',async()=>{
 await campaign();await step('heartbeat');const j=await step('claim');await step('authorize','WA-a',j);await step('record','WA-a',{...j,result:'accepted',provider:'ack-provider'});
 assert.equal((await step('ack','WA-a',{...j,result:'delivered',provider:'ack-provider'})).recorded,true);
 assert.deepEqual((await db.query('select status,message_id from messages')).rows,[{status:'delivered',message_id:'ack-provider'}]);
 assert.equal((await step('ack','WA-a',{...j,result:'delivered',provider:'wrong-provider'})),null);
});
test('SMS fallback requires a ready device and a separate current SMS authorization',async()=>{
 await db.query("insert into multichannel_lines(account_id,line_key,channel,paused,available,device_key,interval_seconds,daily_limit,limit_note)values($1,'SMS-backup','sms',false,true,'device',1,20,'Fictitious test limit')",[account]);
 await campaign({routes:[{channel:'whatsapp_support',line_key:'WA-a'},{channel:'sms',line_key:'SMS-backup'}]});
 assert.equal(await step('claim'),null);assert.equal((await db.query("select count(*)::int as n from multichannel_jobs where mode='sms_live'")).rows[0].n,0);
 await db.query("insert into multichannel_sms_authorizations(account_id,contact_id,purpose,recipient,granted,expires_at,evidence,reviewed_by)values($1,$2,'notice','+51900000001',true,now()+interval '2 hours','Separate SMS consent',$3)",[account,contact,actor]);
 await db.query("insert into multichannel_sms_bindings(account_id,line_key,worker_id,ready_at)values($1,'SMS-backup',$2,now())",[account,w2]);
 await step('claim');const child=(await db.query("select * from multichannel_jobs where mode='sms_live'")).rows[0];assert.ok(child);assert.equal(child.status,'queued');
 await control('pause',{campaign_id:child.campaign_id,value:true});
 await db.query("update multichannel_jobs set status='claimed',worker_id=$2,claim_token=$3,lease_until=now()+interval '2 minutes' where id=$1",[child.id,w2,randomUUID()]);
 await assert.rejects(db.query("update multichannel_jobs set status='dispatching' where id=$1",[child.id]),/Campaign paused/);
});
