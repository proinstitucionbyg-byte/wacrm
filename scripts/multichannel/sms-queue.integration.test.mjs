// Real SQL functions in an in-memory PostgreSQL, fictitious accounts only.
import { PGlite } from '../../output/multichannel-verification/node_modules/@electric-sql/pglite/dist/index.js';
import { readFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { before, beforeEach, after, test } from 'node:test';
import { createSmsGateTransport } from './smsgate-transport.mjs';
import { createSmsGateQueueBridge } from './smsgate-queue-bridge.mjs';
import { createSmsQueueClient } from './smsgate-queue-client.mjs';
import { createSmsGateReader } from './smsgate-reader.mjs';
import { createSmsGateWorker } from './smsgate-worker.mjs';

const db = new PGlite();
const account = randomUUID(), other = randomUUID(), actor = randomUUID(), otherActor = randomUUID();
const contact = randomUUID(), otherContact = randomUUID(), agent = randomUUID();
const line = 'SMS-equipo', device = 'fictional-device', recipient = '+51900000001';
let worker, otherWorker;
before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table accounts(id uuid primary key);
    create table profiles(user_id uuid primary key,account_id uuid,account_role text);
    create table contacts(id uuid primary key,account_id uuid,phone text,phone_normalized text);
    create table conversations(id uuid primary key,account_id uuid,contact_id uuid,status text,
      assigned_agent_id uuid,automation_enabled boolean,ai_enabled boolean);
    grant select on profiles,contacts,conversations to service_role;`);
  for(const name of ['20261029151921_multichannel_worker_queue.sql','20261028173948_multichannel_sms_dispatch.sql'])
    await db.exec(await readFile(new URL('../../supabase/migrations/'+name,import.meta.url),'utf8'));
});
after(()=>db.close());
beforeEach(async()=>{
  await db.exec(`reset role; delete from multichannel_jobs; delete from multichannel_sms_authorization_events; delete from multichannel_sms_authorizations;
    delete from multichannel_sms_bindings; delete from multichannel_workers; delete from multichannel_lines;
    delete from conversations; delete from contacts; delete from profiles; delete from accounts;`);
  await db.query('insert into accounts values ($1),($2)',[account,other]);
  await db.query("insert into profiles values ($1,$2,'owner'),($3,$4,'owner'),($5,$2,'agent')",[actor,account,otherActor,other,agent]);
  await db.query('insert into contacts values ($1,$2,$3,$3),($4,$5,$3,$3)',[contact,account,recipient,otherContact,other]);
  await db.query("insert into conversations values ($1,$2,$3,'open',null,true,true)",[randomUUID(),account,contact]);
  worker=(await owner('register_worker',{name:'Ficticia A',token_hash:'a'.repeat(64)})).id;
  otherWorker=(await owner('register_worker',{name:'Ficticia B',token_hash:'b'.repeat(64)})).id;
  await owner('configure_line',{line_key:line,device_key:device,worker_id:worker});
  await permission(true);
});
async function owner(action,payload,scope=account,who=actor){
  if(action==='configure_line')payload={interval_seconds:1,daily_limit:20,limit_note:'Límites ficticios para pruebas',...payload};
  return (await db.query('select multichannel_sms_control($1,$2,$3,$4) as result',[scope,who,action,JSON.stringify(payload)])).rows[0].result;
}
async function permission(granted,patch={}){
  return owner('set_permission',{contact_id:contact,purpose:'notice',recipient,granted,
    expires_at:new Date(Date.now()+3600000).toISOString(),evidence:'Confirmación humana ficticia',...patch});
}
async function ready(){
  await owner('set_line_availability',{line_key:line,value:true});
  await owner('pause_line',{line_key:line,value:false});
  await step('heartbeat',{ready:true});
}
async function enqueue(patch={}){
  return owner('enqueue',{line_key:line,contact_id:contact,purpose:'notice',body:'Aviso ficticio',dedup_key:randomUUID(),
    run_at:new Date(Date.now()-60000).toISOString(),expires_at:new Date(Date.now()+3600000).toISOString(),...patch});
}
async function step(action,p={},who=worker){
  return (await db.query('select multichannel_sms_step($1,$2,$3,$4,$5,$6,$7,$8,$9) as result',
    [who,action,p.line_key??line,p.device_key??device,p.job_id??null,p.claim_token??null,p.state??null,p.provider_id??null,p.ready??null])).rows[0].result;
}
const claimRef=j=>({job_id:j.id,claim_token:j.claim_token});

test('una línea nueva exige disponibilidad, reanudación y salud reciente',async()=>{
  const job=await enqueue();assert.equal(await step('claim'),null);
  await owner('set_line_availability',{line_key:line,value:true});assert.equal(await step('claim'),null);
  await owner('pause_line',{line_key:line,value:false});assert.equal(await step('claim'),null);
  await step('heartbeat',{ready:true});assert.equal((await step('claim')).id,job.id);
});
test('conserva prioridad y antigüedad de la cola, sin adelantar futuros ni ejecutar vencidos',async()=>{
  await ready();const old=await enqueue({priority:0,run_at:new Date(Date.now()-101*3600000).toISOString()});
  await enqueue({priority:90});
  await enqueue({priority:100,run_at:new Date(Date.now()+3600000).toISOString(),expires_at:new Date(Date.now()+7200000).toISOString()});
  const expired=await enqueue({priority:100,run_at:new Date(Date.now()-3600000).toISOString(),expires_at:new Date(Date.now()-1000).toISOString()});
  assert.equal((await step('claim')).id,old.id);
  assert.equal((await db.query('select status from multichannel_jobs where id=$1',[expired.id])).rows[0].status,'expired');
});
test('revocar permiso entre reserva e inicio impide el intento y conserva el trabajo',async()=>{
  await ready();await enqueue();const j=await step('claim');await permission(false);
  assert.equal((await step('permit',claimRef(j))).allowed,false);
  assert.equal(await step('start',claimRef(j)),null);
  const row=(await db.query('select status,started_at,worker_id from multichannel_jobs where id=$1',[j.id])).rows[0];
  assert.deepEqual(row,{status:'queued',started_at:null,worker_id:null});
});
test('otra laptop, dispositivo o cuenta no acceden a la reserva',async()=>{
  await ready();await enqueue();const j=await step('claim');
  await assert.rejects(step('start',claimRef(j),otherWorker),/Line not assigned/);
  await assert.rejects(step('claim',{device_key:'otra'}),/Line not assigned/);
  await assert.rejects(owner('configure_line',{line_key:line,device_key:device,worker_id:worker},other,otherActor),/Worker unavailable/);
  await assert.rejects(owner('set_permission',{contact_id:otherContact,purpose:'notice',recipient,granted:true,
    expires_at:new Date(Date.now()+3600000).toISOString(),evidence:'No pertenece a esta cuenta'}),/Contact unavailable/);
});
test('el ejecutor antiguo nunca recibe ni completa un SMS real',async()=>{
  await ready();await enqueue();
  const sim=async(action,j={})=>(await db.query('select multichannel_worker_step($1,$2,$3,$4) as job',[worker,action,j.id??null,j.claim_token??null])).rows[0].job;
  assert.equal(await sim('claim'),null);const j=await step('claim');
  assert.equal(await sim('claim'),null);assert.equal(await sim('complete',j),null);
});
test('atención humana, pausa indefinida, cambio de teléfono o salud vieja bloquean reservas',async()=>{
  await ready();await enqueue();
  await db.query('update conversations set assigned_agent_id=$1',[agent]);assert.equal(await step('claim'),null);
  await db.exec('update conversations set assigned_agent_id=null,automation_enabled=false');assert.equal(await step('claim'),null);
  await db.exec('update conversations set automation_enabled=true');
  await db.query("update multichannel_sms_bindings set ready_at=now()-interval '1 minute' where line_key=$1",[line]);
  assert.equal(await step('claim'),null);await step('heartbeat',{ready:true});
  await db.query("update contacts set phone_normalized='+51900000002' where id=$1",[contact]);assert.equal(await step('claim'),null);
});
test('cobranza y autorización antigua o inferida nunca abren un trabajo real',async()=>{
  await assert.rejects(enqueue({purpose:'collection'}),/balance source unavailable/);
  await assert.rejects(permission(true,{recipient:'+51900000002'}),/destination mismatch/);
  await assert.rejects(permission(true,{expires_at:new Date(Date.now()-60000).toISOString()}),/Permission expired/);
  await permission(false);await assert.rejects(enqueue(),/Current SMS permission required/);
  await assert.rejects(owner('register_worker',{name:'Sin permiso',token_hash:'c'.repeat(64)},account,agent),/Owner required/);
});
test('el mismo envío queda deduplicado y su identidad no puede mutarse',async()=>{
  const key='campana-alumno-v1';const job=await enqueue({dedup_key:key});
  await assert.rejects(enqueue({dedup_key:key}),/unique/);
  await assert.rejects(db.query("update multichannel_jobs set recipient='+51900000002' where id=$1",[job.id]),/immutable/);
  assert.equal((await db.query('select dedup_key from multichannel_jobs where id=$1',[job.id])).rows[0].dedup_key,account+':'+key);
});
test('guardar resultado es atómico, idempotente y comprueba el ID de proveedor',async()=>{
  await ready();await enqueue();const claim=await step('claim'),j=await step('start',claimRef(claim));
  const expected='wcm-'+createHash('sha256').update(j.dedup_key).digest('hex');assert.equal(j.provider_id,expected);
  await assert.rejects(step('record',{...claimRef(j),state:'accepted',provider_id:'wcm-'+'0'.repeat(64)}),/Invalid provider result/);
  const payload={...claimRef(j),state:'accepted',provider_id:expected};
  assert.deepEqual(await step('record',payload),{recorded:true,state:'accepted'});
  assert.deepEqual(await step('record',payload),{recorded:true,state:'accepted'});
  assert.equal((await db.query('select worker_id from multichannel_jobs where id=$1',[j.id])).rows[0].worker_id,null);
});
test('inicio interrumpido pasa a revisión y solo se reserva para conciliación',async()=>{
  await ready();await enqueue();const j=await step('start',claimRef(await step('claim')));
  await db.query("update multichannel_jobs set lease_until=now()-interval '1 second' where id=$1",[j.id]);
  const next=await step('claim');assert.equal(next.status,'dispatching');assert.equal(next.id,j.id);
  assert.notEqual(next.claim_token,j.claim_token);assert.equal(next.attempts,1);
  assert.equal(await step('start',claimRef(next)),null);
});
test('aceptado se concilia incluso con la línea pausada y no vuelve a envío',async()=>{
  await ready();await enqueue();const j=await step('start',claimRef(await step('claim')));
  await step('record',{...claimRef(j),state:'accepted',provider_id:j.provider_id});
  await db.query("update multichannel_jobs set next_check_at=now()-interval '1 second' where id=$1",[j.id]);
  await owner('pause_line',{line_key:line,value:true});const next=await step('claim');
  assert.equal(next.status,'dispatching');assert.equal(next.attempts,1);
});
test('roles de navegador no pueden leer ni invocar controles o reservas',async()=>{
  for(const role of ['anon','authenticated']){
    await db.exec('set role '+role);
    await assert.rejects(db.query('select * from multichannel_sms_authorizations'),/permission denied/);
    await assert.rejects(step('claim'),/permission denied/);
    await assert.rejects(permission(false),/permission denied/);await db.exec('reset role');
  }
});
test('permisos conservan evidencia de alta/revocación y la salud es propia de cada laptop',async()=>{
  await permission(false);
  assert.equal((await db.query('select count(*)::int as n from multichannel_sms_authorization_events')).rows[0].n,2);
  await permission(true);await ready();await enqueue();
  await owner('configure_line',{line_key:line,device_key:device,worker_id:otherWorker});
  assert.equal(await step('claim',{},otherWorker),null);
  await step('heartbeat',{ready:true},otherWorker);assert.equal((await step('claim',{},otherWorker)).worker_id,otherWorker);
});
test('intervalo y límite diario de la línea se comprueban en reserva e inicio',async()=>{
  await owner('configure_line',{line_key:line,device_key:device,worker_id:worker,interval_seconds:60,daily_limit:1});
  await ready();await enqueue();const j=await step('start',claimRef(await step('claim')));
  await step('record',{...claimRef(j),state:'accepted',provider_id:j.provider_id});
  await enqueue();assert.equal(await step('claim'),null);
  await db.query("update multichannel_jobs set started_at=now()-interval '2 minutes' where id=$1",[j.id]);
  assert.equal(await step('claim'),null); // Still blocked by the daily cap.
  await owner('configure_line',{line_key:line,device_key:device,worker_id:worker,interval_seconds:60,daily_limit:2});
  assert.notEqual((await step('claim')).id,j.id);
});
test('un estado Sent confirmado no retrocede a accepted por una lectura posterior',async()=>{
  await ready();await enqueue();const j=await step('start',claimRef(await step('claim')));
  await step('record',{...claimRef(j),state:'sent',provider_id:j.provider_id});
  await db.exec("update multichannel_jobs set next_check_at=now()-interval '1 second'");const next=await step('claim');
  assert.deepEqual(await step('record',{...claimRef(next),state:'accepted',provider_id:j.provider_id}),{recorded:true,state:'sent'});
});
test('HTTP cliente, SQL real, ejecutor y transporte: accepted y delivered con un solo POST simulado',async()=>{
  await ready();await enqueue();const entries=new Map(),calls=[];let providerId;
  const journal={reserve:async(k,v)=>{if(entries.has(k))return false;entries.set(k,v);return true;},
    read:async k=>entries.get(k),update:async(k,v)=>{entries.set(k,v);}};
  const config={baseUrl:'http://192.168.1.5:8080',username:'ficticio',password:'fake',deviceKey:device,enabled:true,simReady:true};
  const smsFetch=async(url,init)=>{
    if(url.pathname==='/health')return Response.json({status:'pass'});
    calls.push(init.method);if(init.method==='POST')providerId=JSON.parse(init.body).id;
    return Response.json({id:providerId,state:init.method==='POST'?'Pending':'Delivered'},{status:init.method==='POST'?202:200});
  };
  const transport=createSmsGateTransport(config,{journal,fetchImpl:smsFetch});
  const reader=createSmsGateReader(config,{fetchImpl:smsFetch});
  const client=createSmsQueueClient({baseUrl:'https://crm.example.test',token:'wcm_'+'a'.repeat(64),lineKey:line,deviceKey:device,
    fetchImpl:async(_,init)=>{
      const body=JSON.parse(init.body);const result=await step(body.action,body);
      const key=body.action==='identity'?'identity':body.action==='heartbeat'?'heartbeat':body.action==='permit'?'permit':body.action==='record'?'receipt':'job';
      return Response.json({mode:'sms_live',[key]:result});
    }});
  const runner=createSmsGateWorker({enabled:true,client,reader,transport});
  assert.equal(await runner.runOnce(),'accepted');
  await db.exec("update multichannel_jobs set next_check_at=now()-interval '1 second'");
  assert.equal(await runner.runOnce(),'delivered');assert.deepEqual(calls,['POST','GET']);
  assert.equal((await db.query('select status,attempts from multichannel_jobs')).rows[0].status,'delivered');
});
test('otra laptop autorizada concilia sin diario compartido y nunca hace otro POST',async()=>{
  await ready();await enqueue();const j=await step('start',claimRef(await step('claim')));
  await step('record',{...claimRef(j),state:'accepted',provider_id:j.provider_id});
  await db.exec("update multichannel_jobs set next_check_at=now()-interval '1 second'");
  await owner('configure_line',{line_key:line,device_key:device,worker_id:otherWorker});
  await step('heartbeat',{ready:true},otherWorker);const calls=[];
  const transport=createSmsGateTransport({baseUrl:'http://192.168.1.5:8080',username:'ficticio',password:'fake',deviceKey:device,enabled:true,simReady:true},
    {journal:{reserve:async()=>assert.fail('No reservar otro envío'),read:async()=>{throw Error('No local journal');},update:async()=>assert.fail('No reemplazar historial')},
      fetchImpl:async(_,init)=>{calls.push(init.method);assert.equal(init.method,'GET');return Response.json({id:j.provider_id,state:'Delivered'});}});
  const bridge=createSmsGateQueueBridge({enabled:true,accountId:account,workerId:otherWorker,lineKey:line,deviceKey:device,transport,
    queue:{claim:()=>step('claim',{},otherWorker),start:ref=>step('start',ref,otherWorker),recordResult:r=>step('record',r,otherWorker)},
    revalidate:job=>step('permit',claimRef(job),otherWorker)});
  assert.equal(await bridge.runOnce(),'delivered');assert.deepEqual(calls,['GET']);
});
