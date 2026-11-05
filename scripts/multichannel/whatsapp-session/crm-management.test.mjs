import test from 'node:test';
import assert from 'node:assert/strict';
import {executeManagementCommand,managementSnapshot,startCrmManagement} from './crm-management.mjs';
const accountId='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222';
const line={lineKey:'WA-test',label:'Soporte',status:'ready',active:true,linkedPhone:'51911111111'};
const command={id,account_id:accountId,status:'running',operation:'connect',line_key:line.lineKey};

test('management rejects another account and a changed phone before touching a profile',async()=>{
 let calls=0;const manager={list:()=>[line],connect:async()=>calls++,unlink:async()=>calls++};
 await assert.rejects(executeManagementCommand(manager,{...command,account_id:id},accountId));
 await assert.rejects(executeManagementCommand(manager,{...command,operation:'unlink',expected_phone:'51922222222'},accountId));
 assert.equal(calls,0);
 await executeManagementCommand(manager,command,accountId);assert.equal(calls,1);
});
test('a management snapshot contains connection details and an expiring QR, never chat content',async()=>{
 let calls=0;const ready={...line,secret:'must-not-leave',messages:['private']};
 const pending={...line,lineKey:'WA-second',status:'awaiting_qr',linkedPhone:null};
 const manager={list:()=>[ready,pending],get:()=>({adapter:{qrImage:()=>null,qr:()=>{calls++;return 'native-qr';}}})};
 const result=await managementSnapshot(manager,async()=> 'data:image/png;base64,YQ==');
 assert.equal(calls,1);assert.equal(result[0].qr,null);assert.equal(result[1].qr,'data:image/png;base64,YQ==');
 assert.ok(!JSON.stringify(result).includes('must-not-leave'));assert.ok(!JSON.stringify(result).includes('private'));
});
test('legacy archived profiles cannot reopen or produce a QR through owner management',async()=>{
 let touched=0;const archived={...line,label:'Historial Historial WhatsApp 03 12345678',status:'awaiting_qr'};
 const manager={list:()=>[archived],get:()=>{touched++;return {adapter:{qr:()=> 'must-not-show'}};},connect:async()=>touched++};
 await assert.rejects(executeManagementCommand(manager,command,accountId),/historial/);
 const snapshot=await managementSnapshot(manager,async()=> 'data:image/png;base64,YQ==');
 assert.equal(snapshot[0].archived,true);assert.equal(snapshot[0].qr,null);assert.equal(touched,0);
});
test('a lost command acknowledgement is retried without executing the action again',async()=>{
 let calls=0,requests=0,finished;
 const done=new Promise(resolve=>{finished=resolve;});
 const manager={list:()=>[],connect:async()=>calls++};manager.list=()=>[line];
 const poller=startCrmManagement({accountId,origin:'https://crm.example.test',token:'wcm_'+'a'.repeat(64),manager,qrToDataUrl:async()=>null,pollMs:1000,
  fetchImpl:async(_url,init)=>{requests++;const body=JSON.parse(init.body);
   if(requests===1)return Response.json({accountId,command});
   assert.equal(body.completed.id,id);
   if(requests===2)throw Error('Lost response');
   finished();return Response.json({accountId,acknowledged:id,command:null});
  }});
 await Promise.race([done,new Promise((_,reject)=>setTimeout(()=>reject(Error('No retry')),4000))]);
 await poller.stop();assert.equal(calls,1);
});
