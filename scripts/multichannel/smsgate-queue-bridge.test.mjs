// Contract tests against the actual SMSGate transport with mocked network only.
// No phone, credential, production queue, migration or background loop is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSmsGateQueueBridge } from './smsgate-queue-bridge.mjs';
import { createSmsGateTransport } from './smsgate-transport.mjs';

const accountId='11111111-1111-4111-8111-111111111111';
const workerId='22222222-2222-4222-8222-222222222222';
const id='33333333-3333-4333-8333-333333333333';
const token='44444444-4444-4444-8444-444444444444';
const lineKey='SMS-prueba',deviceKey='fictional-device';
function fixture({enabled=true,patch={},permitPatch={},onPermit,onStart,onRecord,network}={}) {
  let clock=Date.parse('2026-11-01T15:00:00Z'),checks=0;
  const now=()=>clock, records=[],calls=[],journalRows=new Map();
  const row={id,account_id:accountId,worker_id:workerId,claim_token:token,line_key:lineKey,
    mode:'sms_live',channel:'sms',purpose:'collection',dedup_key:'fictional-campaign-student-v1',
    recipient:'+51900000001',body:'Texto ficticio',status:'claimed',
    run_at:'2026-11-01T14:00:00Z',expires_at:'2026-11-01T16:00:00Z',lease_until:'2026-11-01T15:02:00Z',...patch};
  const journal={
    async reserve(key,value){if(journalRows.has(key))return false;journalRows.set(key,value);return true;},
    async read(key){if(!journalRows.has(key))throw Error('missing');return journalRows.get(key);},
    async update(key,value){journalRows.set(key,value);},
  };
  let remoteId;
  const config={baseUrl:'http://192.168.1.5:8080',username:'fictional',password:'fake',deviceKey,enabled:true,simReady:true};
  const transport=createSmsGateTransport(config,{journal,now,fetchImpl:async(url,init)=>{
    calls.push({method:init.method,path:url.pathname});
    if(init.method==='POST')remoteId=JSON.parse(init.body).id;
    if(network)return network(url,init,remoteId);
    return Response.json({id:remoteId,state:'Sent'},{status:init.method==='POST'?202:200});
  }});
  const queue={
    async claim(scope){assert.deepEqual(scope,{account_id:accountId,worker_id:workerId,line_key:lineKey});return ['claimed','dispatching'].includes(row.status)?{...row}:null;},
    async start(claim){assert.deepEqual(claim,{job_id:id,claim_token:token});row.status='dispatching';return onStart?onStart({...row}):{...row};},
    async recordResult(result){records.push(result);if(onRecord)return onRecord(result);row.status=result.state;return {recorded:true};},
  };
  const revalidate=async job=>{
    checks++;
    assert(Object.isFrozen(job));
    const permit={accountId,jobId:job.id,lineKey,deviceKey,allowed:true,paused:false,
      permissionConfirmed:true,humanActive:false,lineAvailable:true,deviceReady:true,
      paymentStatus:'pending',checkedAt:new Date(now()).toISOString(),...permitPatch};
    return onPermit?onPermit(permit,checks,{advance:ms=>{clock+=ms;}}):permit;
  };
  const create=overrides=>createSmsGateQueueBridge({enabled,accountId,workerId,lineKey,deviceKey,queue,transport,revalidate,now,...overrides});
  return {bridge:create(),create,row,queue,transport,config,records,calls,journalRows,checks:()=>checks,advance:ms=>{clock+=ms;}};
}

test('queda deshabilitado por defecto y nunca consulta la cola',async()=>{
  const f=fixture();let claims=0;
  const bridge=f.create({enabled:undefined,queue:{...f.queue,claim:async()=>{claims++;}}});
  assert.equal(await bridge.runOnce(),'disabled');assert.equal(claims,0);assert.equal(f.calls.length,0);
});

test('exige dispositivo del transporte y dependencias explícitas del servidor',()=>{
  const f=fixture();assert.throws(()=>f.create({deviceKey:'another-device'}),/configurar/);
  assert.throws(()=>f.create({revalidate:null}),/configurar/);
  assert.throws(()=>f.create({queue:{...f.queue,recordResult:null}}),/configurar/);
});

test('rechaza simulación, otra cuenta/laptop/línea, canal, fechas y reserva inválidos sin red',async()=>{
  for(const patch of [{mode:'simulation'},{account_id:'another'},{worker_id:'another'},
    {line_key:'SMS-ajena'},{channel:'whatsapp_support'},{claim_token:'missing'},
    {lease_until:'2026-11-01T14:59:59Z'},{expires_at:'invalid'},{purpose:'unknown'},
    {recipient:'TEST-alumno'},{run_at:'2026-11-01T17:00:00Z'}]) {
    const f=fixture({patch});assert.equal(await f.bridge.runOnce(),'blocked');
    assert.equal(f.calls.length,0);assert.equal(f.records.length,0);
  }
});

test('bloquea permiso vencido, ajeno, pausa, cobro resuelto y atención humana',async()=>{
  for(const permitPatch of [{allowed:false},{permissionConfirmed:false},{paused:true},
    {humanActive:true},{lineAvailable:false},{deviceReady:false},{paymentStatus:'resolved'},
    {paymentStatus:'unknown'},{accountId:'other'},{jobId:'other'},{lineKey:'SMS-other'},
    {deviceKey:'other'},{checkedAt:'2026-11-01T14:59:00Z'},{checkedAt:'2026-11-01T15:01:00Z'}]) {
    const f=fixture({permitPatch});assert.equal(await f.bridge.runOnce(),'blocked');
    assert.equal(f.row.status,'claimed');assert.equal(f.calls.length,0);
  }
});

test('revalida después de reservar e iniciar; una pausa o pago nuevo impide POST',async()=>{
  for(const change of [{paused:true},{humanActive:true},{paymentStatus:'resolved'},{lineAvailable:false}]){
    const f=fixture({onPermit:(permit,count)=>count===2?{...permit,...change}:permit});
    assert.equal(await f.bridge.runOnce(),'blocked');assert.equal(f.checks(),2);
    assert.equal(f.calls.length,0);assert.equal(f.records[0].state,'needs_review');
  }
});

test('no permite cambiar mensaje, destino o identidad al confirmar el inicio',async()=>{
  for(const change of [{body:'otro texto'},{recipient:'+51900000002'},{dedup_key:'otra'},
    {account_id:'otra'},{line_key:'SMS-otra'},{claim_token:'55555555-5555-4555-8555-555555555555'}]){
    const f=fixture({onStart:job=>({...job,...change})});
    assert.equal(await f.bridge.runOnce(),'blocked');assert.equal(f.calls.length,0);
  }
});

test('una reserva que vence durante la revalidación no llega al transporte',async()=>{
  const f=fixture({onPermit:(permit,count,{advance})=>{if(count===2)advance(120001);return permit;}});
  assert.equal(await f.bridge.runOnce(),'blocked');assert.equal(f.calls.length,0);
});

test('conserva una copia de la tarea aunque el adaptador reutilice y cambie su objeto original',async()=>{
  const f=fixture();
  const queue={...f.queue,claim:async()=>f.row,start:async()=>{
    f.row.status='dispatching';f.row.recipient='+51900000002';return {...f.row};
  }};
  assert.equal(await f.create({queue}).runOnce(),'blocked');assert.equal(f.calls.length,0);
});

test('202 se registra como aceptado y nunca como entregado; no copia texto ni teléfonos al resultado',async()=>{
  const f=fixture();assert.equal(await f.bridge.runOnce(),'accepted');assert.equal(f.checks(),2);
  assert.deepEqual(f.calls,[{method:'POST',path:'/message'}]);
  assert.deepEqual(Object.keys(f.records[0]).sort(),['checked_at','claim_token','job_id','provider_id','state']);
  assert.equal(f.records[0].state,'accepted');assert.equal(f.records[0].claim_token,token);
  assert.equal(await f.bridge.runOnce(),'idle');
});

test('timeout queda incierto; al recuperar solo consulta y no vuelve a POST',async()=>{
  const f=fixture({network:async(_,init)=>{if(init.method==='POST')throw Error('provider secret');return new Response('',{status:404});}});
  assert.equal(await f.bridge.runOnce(),'needs_review');f.row.status='dispatching';
  assert.equal(await f.bridge.runOnce(),'needs_review');
  assert.deepEqual(f.calls.map(x=>x.method),['POST','GET']);
});

test('si se pierde el guardado central, concilia el diario previo y conserva un solo POST',async()=>{
  let saved=false;const f=fixture({onRecord:()=>{if(!saved){saved=true;throw Error('server');}return {recorded:true};}});
  assert.equal(await f.bridge.runOnce(),'needs_review');
  assert.equal(f.row.status,'dispatching');
  assert.equal(await f.bridge.runOnce(),'sent');
  assert.deepEqual(f.calls.map(x=>x.method),['POST','GET']);
  assert.equal(f.records[1].provider_id,f.records[0].provider_id);
});

test('reserva dispatching sin diario local queda en revisión sin intentar POST',async()=>{
  const f=fixture({patch:{status:'dispatching'}});
  assert.equal(await f.bridge.runOnce(),'needs_review');assert.equal(f.calls.length,0);
});

test('un intento previo con la misma clave solo se concilia, incluso si vuelve claimed',async()=>{
  const f=fixture();assert.equal(await f.bridge.runOnce(),'accepted');f.row.status='claimed';
  assert.equal(await f.bridge.runOnce(),'sent');
  assert.deepEqual(f.calls.map(x=>x.method),['POST','GET']);
});

test('una respuesta de proveedor con ID incorrecto no se registra como éxito',async()=>{
  const f=fixture();const transport={deviceKey,dispatch:async()=>({id:'wrong',state:'delivered'}),reconcile:f.transport.reconcile};
  assert.equal(await f.create({transport}).runOnce(),'needs_review');
  assert.equal(f.records[0].state,'needs_review');
});

test('no permite dos vueltas locales mientras se guarda o concilia una reserva',async()=>{
  let release,arrived;
  const atRecord=new Promise(resolve=>{arrived=resolve;});
  const wait=new Promise(resolve=>{release=resolve;});
  const f=fixture({onRecord:async()=>{arrived();await wait;return {recorded:true};}});
  const first=f.bridge.runOnce();await atRecord;
  assert.equal(await f.bridge.runOnce(),'busy');release();assert.equal(await first,'accepted');
  assert.equal(f.calls.filter(x=>x.method==='POST').length,1);
});

test('la identidad del dispositivo queda fija aunque se modifique el objeto de configuración',async()=>{
  const f=fixture();f.config.deviceKey='another';
  assert.equal(f.transport.deviceKey,deviceKey);assert.equal(await f.bridge.runOnce(),'accepted');
  assert.equal([...f.journalRows.values()][0].deviceKey,deviceKey);
});
