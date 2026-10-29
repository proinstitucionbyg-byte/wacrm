// Run after installing the optional verification runtime documented in the manual.
// No network, production credentials or real contacts are used by these tests.
import { PGlite } from '../../output/multichannel-verification/node_modules/@electric-sql/pglite/dist/index.js';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { before, after, beforeEach, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { runOnce } from './simulation-worker.mjs';

const db = new PGlite();
const account = randomUUID(), other = randomUUID();
let w1, w2, w3;
before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.accounts(id uuid primary key);`);
  await db.exec(await readFile(new URL('../../supabase/migrations/20261029151921_multichannel_worker_queue.sql', import.meta.url), 'utf8'));
  await db.query('insert into accounts values ($1), ($2)', [account, other]);
});
after(() => db.close());
beforeEach(async () => {
  await db.exec('reset role; delete from multichannel_jobs; delete from multichannel_workers; delete from multichannel_lines;');
  await db.query(`insert into multichannel_lines(account_id,line_key,channel,paused,available)
    values ($1,'TEST-linea-1','sms',false,true),($1,'TEST-linea-2','sms',false,true)`, [account]);
  const workers = await db.query(`insert into multichannel_workers(account_id,name,token_hash)
    values ($1,'Laptop A',repeat('a',64)),($1,'Laptop B',repeat('b',64)),($2,'Otra cuenta',repeat('c',64)) returning id`, [account, other]);
  [w1,w2,w3] = workers.rows.map(row => row.id);
});
async function add({ line = 'TEST-linea-1', priority = 0, due = -60, expiry = 3600, owner = account, key = randomUUID() } = {}) {
  return (await db.query(`insert into multichannel_jobs
    (account_id,channel,line_key,recipient,body,dedup_key,priority,run_at,expires_at)
    values ($1,'sms',$2,'TEST-alumno','Prueba',$3,$4,now()+make_interval(secs=>$5),now()+make_interval(secs=>$6)) returning *`,
  [owner,line,key,priority,due,expiry])).rows[0];
}
async function step(worker, action = 'claim', job = {}) {
  return (await db.query('select multichannel_worker_step($1,$2,$3,$4) as job',
    [worker,action,job.id ?? null,job.claim_token ?? null])).rows[0].job;
}
async function expireLease(id) {
  await db.query("update multichannel_jobs set lease_until=now()-interval '1 second' where id=$1",[id]);
}
test('dos laptops no toman el mismo trabajo ni dos trabajos de la misma línea', async () => {
  const first = await add(); await add();
  const [a,b] = await Promise.all([step(w1),step(w2)]);
  assert.equal(a.id,first.id); assert.equal(b,null);
  assert.equal((await step(w1)).claim_token,a.claim_token);
});
test('líneas distintas avanzan en paralelo y un worker no acumula trabajos', async () => {
  await add(); await add({line:'TEST-linea-2'});
  const a = await step(w1), b = await step(w2);
  assert.notEqual(a.id,b.id); assert.equal((await step(w1)).id,a.id);
});
test('al despertar se recupera lo reservado sin enviar, con token nuevo', async () => {
  await add(); const old = await step(w1); await expireLease(old.id);
  const next = await step(w2);
  assert.equal(next.id,old.id); assert.notEqual(next.claim_token,old.claim_token);
  assert.equal(await step(w1,'start',old),null);
});
test('un envío iniciado e interrumpido queda para revisión y nunca se reenvía', async () => {
  await add(); const job = await step(w1); await step(w1,'start',job); await expireLease(job.id);
  assert.equal(await step(w2),null);
  assert.equal((await db.query('select status from multichannel_jobs where id=$1',[job.id])).rows[0].status,'needs_review');
  assert.equal(await step(w1,'complete',job),null);
});
test('respeta prioridades, antigüedad y excluye programados futuros y vencidos', async () => {
  const old = await add({due:-3600*101});
  await add({priority:90}); await add({priority:100,due:3600,expiry:7200});
  const expired = await add({priority:100,due:-100,expiry:-1});
  assert.equal((await step(w1)).id,old.id);
  assert.equal((await db.query('select status from multichannel_jobs where id=$1',[expired.id])).rows[0].status,'expired');
});
test('revalida el vencimiento antes de iniciar y no permite tokens ajenos', async () => {
  await add(); const job = await step(w1);
  assert.equal(await step(w2,'start',job),null);
  assert.equal(await step(w1,'start',{...job,claim_token:randomUUID()}),null);
  await db.query("update multichannel_jobs set run_at=now()-interval '2 hours',expires_at=now()-interval '1 second' where id=$1",[job.id]);
  assert.equal(await step(w1,'start',job),null);
});
test('separación de cuentas, deduplicación y revocación de laptop', async () => {
  await add({key:'misma-campana-alumno'});
  await assert.rejects(add({key:'misma-campana-alumno'}),/unique/);
  assert.equal(await step(w3),null);
  await db.query('update multichannel_workers set enabled=false where id=$1',[w1]);
  await assert.rejects(step(w1),/Worker unavailable/);
});
test('RLS y permisos impiden acceso o RPC directo con roles de navegador', async () => {
  for (const role of ['anon','authenticated']) {
    await db.exec(`set role ${role}`);
    await assert.rejects(db.query('select * from multichannel_jobs'),/permission denied/);
    await assert.rejects(step(w1),/permission denied/);
    await assert.rejects(db.query('select * from multichannel_lines'),/permission denied/);
    await assert.rejects(db.query("select multichannel_line_control($1,'pause','TEST-linea-1',null,false)",[account]),/permission denied/);
    await db.exec('reset role');
  }
  await db.exec('set role service_role');
  assert.equal(await step(w1),null);
});
test('cliente completa de inicio a fin como SIMULADO y conserva el historial', async () => {
  await add();
  const call = async payload => ({job:await step(w1,payload.action,{id:payload.job_id,claim_token:payload.claim_token})});
  assert.equal(await runOnce(call),'simulated');
  assert.equal(await runOnce(call),'idle');
  assert.equal((await db.query('select status,attempts from multichannel_jobs')).rows[0].status,'simulated');
  assert.equal((await db.query('select last_worker_id from multichannel_jobs')).rows[0].last_worker_id,w1);
});
test('una respuesta HTTP perdida después de iniciar no repite el efecto', async () => {
  await add(); const claim = await step(w1); const job = await step(w1,'start',claim);
  const calls=[];
  assert.equal(await runOnce(async payload=> {calls.push(payload.action);return {job};}),'review');
  assert.deepEqual(calls,['claim']);
});
test('el cliente se niega a iniciar trabajos que no sean de simulación', async () => {
  const calls=[];
  const result=await runOnce(async payload=> {
    calls.push(payload.action);
    return {job:{id:randomUUID(),status:'claimed',mode:'live'}};
  });
  assert.equal(result,'review'); assert.deepEqual(calls,['claim']);
});
test('un lote con una clave existente revierte también las filas nuevas', async () => {
  await add({key:'existente'});
  await assert.rejects(db.query(`insert into multichannel_jobs
    (account_id,channel,line_key,recipient,body,dedup_key,run_at,expires_at)
    values ($1,'sms','TEST-linea','TEST-a','Prueba','nuevo',now(),now()+interval '1 hour'),
      ($1,'sms','TEST-linea','TEST-b','Prueba','existente',now(),now()+interval '1 hour')`,[account]),/unique/);
  assert.equal((await db.query('select count(*)::int as n from multichannel_jobs')).rows[0].n,1);
});

test('una línea sin registrar, pausada o no disponible no reserva trabajos', async () => {
  await db.exec('delete from multichannel_lines');
  const job = await add();
  assert.equal(await step(w1), null);
  await db.query("select multichannel_line_control($1,'register','TEST-linea-1','sms',null)", [account]);
  assert.equal(await step(w1), null);
  await db.query("select multichannel_line_control($1,'availability','TEST-linea-1',null,true)", [account]);
  assert.equal(await step(w1), null);
  await db.query("select multichannel_line_control($1,'pause','TEST-linea-1',null,false)", [account]);
  assert.equal((await step(w1)).id, job.id);
});

test('una pausa entre reserva e inicio libera el trabajo sin simularlo', async () => {
  await add(); const claim = await step(w1);
  await db.query("select multichannel_line_control($1,'pause','TEST-linea-1',null,true)", [account]);
  assert.equal(await step(w1,'start',claim),null);
  const stored = (await db.query('select * from multichannel_jobs where id=$1',[claim.id])).rows[0];
  assert.equal(stored.status,'queued'); assert.equal(stored.started_at,null);
  assert.equal(stored.worker_id,null); assert.equal(await step(w2),null);
  // Availability changes and repeated registration never clear a manual pause.
  await db.query("select multichannel_line_control($1,'availability','TEST-linea-1',null,true)", [account]);
  await db.query("select multichannel_line_control($1,'register','TEST-linea-1','sms',null)", [account]);
  assert.equal(await step(w2),null);
  await db.query("select multichannel_line_control($1,'pause','TEST-linea-1',null,false)", [account]);
  const next = await step(w2);
  assert.equal(next.id,claim.id); assert.notEqual(next.claim_token,claim.claim_token);
  assert.equal(await step(w1,'start',claim),null);
});

test('la disponibilidad se revalida al iniciar y otras líneas siguen avanzando', async () => {
  await add(); const claim = await step(w1);
  await add({line:'TEST-linea-2'});
  await db.query("select multichannel_line_control($1,'availability','TEST-linea-1',null,false)", [account]);
  assert.equal(await step(w1,'start',claim),null);
  assert.equal((await step(w2)).line_key,'TEST-linea-2');
});

test('pausar después de iniciar conserva el resultado y el historial', async () => {
  await add(); const claim = await step(w1); await step(w1,'start',claim);
  await db.query("select multichannel_line_control($1,'pause','TEST-linea-1',null,true)", [account]);
  assert.equal((await step(w1,'complete',claim)).status,'simulated');
  assert.equal((await db.query('select paused from multichannel_lines where account_id=$1 and line_key=$2',[account,claim.line_key])).rows[0].paused,true);
});

test('un resultado incierto permanece en revisión aunque se reactive su línea', async () => {
  await add(); const claim = await step(w1); await step(w1,'start',claim); await expireLease(claim.id);
  await db.query("select multichannel_line_control($1,'pause','TEST-linea-1',null,true)", [account]);
  assert.equal(await step(w2),null);
  await db.query("select multichannel_line_control($1,'pause','TEST-linea-1',null,false)", [account]);
  assert.equal(await step(w2),null);
  assert.equal((await db.query('select status from multichannel_jobs where id=$1',[claim.id])).rows[0].status,'needs_review');
});

test('líneas de otra cuenta o de otro canal no habilitan el trabajo', async () => {
  await db.exec('delete from multichannel_lines'); await add();
  await db.query("insert into multichannel_lines(account_id,line_key,channel,paused,available) values ($1,'TEST-linea-1','sms',false,true),($2,'TEST-linea-1','whatsapp_support',false,true)",[other,account]);
  assert.equal(await step(w1),null);
  await assert.rejects(db.query("select multichannel_line_control($1,'register','TEST-linea-1','sms',null)",[account]),/Line channel mismatch/);
  assert.equal((await db.query("select multichannel_line_control($1,'pause','TEST-inexistente',null,true) as line",[account])).rows[0].line,null);
});
