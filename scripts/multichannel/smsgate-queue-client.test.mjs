import test from 'node:test';
import assert from 'node:assert/strict';
import { createSmsQueueClient } from './smsgate-queue-client.mjs';
import { createSmsGateWorker } from './smsgate-worker.mjs';
const config={baseUrl:'https://crm.example.test',token:'wcm_'+'a'.repeat(64),lineKey:'SMS-equipo',deviceKey:'ficticio'};
const accountId='11111111-1111-4111-8111-111111111111',workerId='22222222-2222-4222-8222-222222222222';
const identity={accountId,workerId,lineKey:config.lineKey,deviceKey:config.deviceKey};

test('no permite HTTP público, secretos en URL, clave principal ni línea TEST',()=>{
  for(const patch of [{baseUrl:'http://crm.example.test'},{baseUrl:'https://user:pass@crm.example.test'},
    {baseUrl:'https://crm.example.test/?token=secret'},{token:'service-role'},{lineKey:'TEST-linea'}])
    assert.throws(()=>createSmsQueueClient({...config,...patch}),/inválida/);
});
test('usa ruta SMS, sin redirección, y solo identidad de reserva al pedir permiso',async()=>{
  const requests=[];const client=createSmsQueueClient({...config,fetchImpl:async(url,init)=>{
    requests.push({url:String(url),init,body:JSON.parse(init.body)});
    return Response.json({mode:'sms_live',permit:{allowed:false}});
  }});
  assert.equal((await client.revalidate({id:accountId,claim_token:workerId,account_id:'otra',allowed:true,recipient:'privado'})).allowed,false);
  assert.equal(requests[0].url,'https://crm.example.test/api/multichannel/sms/worker');
  assert.equal(requests[0].init.redirect,'error');
  assert.deepEqual(requests[0].body,{action:'permit',line_key:'SMS-equipo',device_key:'ficticio',job_id:accountId,claim_token:workerId});
});
test('una respuesta de simulación nunca se usa como cola SMS real',async()=>{
  const client=createSmsQueueClient({...config,fetchImpl:async()=>Response.json({mode:'simulation',job:{}})});
  await assert.rejects(client.queue.claim(),/otro modo/);
});
test('timeout no se reintenta ni imprime detalles de acceso',async()=>{
  let calls=0;const client=createSmsQueueClient({...config,fetchImpl:async()=>{calls++;throw Error(config.token);}});
  await assert.rejects(client.identity(),error=>!error.message.includes(config.token));assert.equal(calls,1);
});
test('revocación detiene el cliente sin exponer cuerpo de error',async()=>{
  const client=createSmsQueueClient({...config,fetchImpl:async()=>new Response(config.token,{status:403})});
  await assert.rejects(client.queue.claim(),error=>error.code==='REVOKED'&&!error.message.includes(config.token));
});
test('salud o guardado de heartbeat no confirmados impiden tomar una tarea',async()=>{
  let claims=0;const heartbeats=[];
  const client={identity:async()=>identity,heartbeat:async value=>{heartbeats.push(value);},
    queue:{claim:async()=>{claims++;},start:async()=>null,recordResult:async()=>({recorded:false})},revalidate:async()=>null};
  const transport={deviceKey:'ficticio',dispatch:async()=>assert.fail('No debe enviar'),reconcile:async()=>null};
  const reader={health:async()=>({status:'warn'})};
  const worker=createSmsGateWorker({enabled:true,client,reader,transport});
  assert.equal(await worker.runOnce(),'device_unavailable');assert.deepEqual(heartbeats,[false]);assert.equal(claims,0);
  const failing=createSmsGateWorker({enabled:true,client:{...client,heartbeat:async()=>{throw Error('server');}},
    reader:{health:async()=>({status:'pass'})},transport});
  await assert.rejects(failing.runOnce(),/server/);assert.equal(claims,0);
});
test('ejecutor deshabilitado por defecto no consulta servidor ni teléfono',async()=>{
  let calls=0;const client={identity:async()=>{calls++;},heartbeat:async()=>{calls++;}};
  const worker=createSmsGateWorker({client,reader:{health:async()=>{calls++;}},transport:{dispatch(){calls++;}}});
  assert.equal(await worker.runOnce(),'disabled');assert.equal(calls,0);
});
test('heartbeat requiere confirmación explícita y la identidad debe corresponder a la línea',async()=>{
  const client=createSmsQueueClient({...config,fetchImpl:async()=>Response.json({mode:'sms_live',heartbeat:{recorded:false},identity:{...identity,lineKey:'SMS-ajena'}})});
  await assert.rejects(client.heartbeat(true),/no confirmada/);await assert.rejects(client.identity(),/Identidad/);
});
