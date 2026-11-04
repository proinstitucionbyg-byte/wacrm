import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { Script } from 'node:vm';
import { randomUUID } from 'node:crypto';
import { startSessionPanel } from './panel.mjs';

async function fixture(fn) {
  const adapter={status:()=>({status:'awaiting_qr',received:0,recent:[]}),qr:()=> 'private-QR'};
  const panel=await startSessionPanel({adapter,port:0,qrToSvg:async()=>'<svg>private-QR</svg>'});
  try { await fn(panel); } finally { await panel.close(); }
}
const headers=p=>({Authorization:'Bearer '+p.token});
test('pause and recovery require the owner panel token and reject unknown line or forged scope',async()=>{
 const changes=[];let repairs=0;const automationControl={status:()=>({allPaused:false,pausedLines:[]}),isPaused:()=>false,set:async value=>{changes.push(value);return value;}};
 const lineManager={list:()=>[{lineKey:'WA-main'}],recover:async key=>{assert.equal(key,'WA-main');repairs++;return{status:'ready',uncertainReplayed:false};}};
 const p=await startSessionPanel({adapter:{status:()=>({lineKey:'WA-main'}),qr:()=>null},automationControl,lineManager,port:0,qrToSvg:async()=>''});
 const post=body=>({method:'POST',headers:{...headers(p),'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{
  assert.equal((await fetch(p.origin+'/api/automation',{method:'POST'})).status,401);
  assert.equal((await fetch(p.origin+'/api/automation',post({scope:'all',paused:true,line_key:'WA-main'}))).status,400);
  assert.equal((await fetch(p.origin+'/api/automation',post({scope:'line',paused:true,line_key:'WA-unknown'}))).status,400);
  assert.equal(changes.length,0);
  assert.equal((await fetch(p.origin+'/api/automation',post({scope:'all',paused:true}))).status,200);assert.deepEqual(changes,[{paused:true}]);
  assert.equal((await fetch(p.origin+'/api/lines/WA-main/recover',{method:'POST'})).status,401);
  assert.equal((await fetch(p.origin+'/api/lines/WA-main/recover',post({}))).status,200);assert.equal(repairs,1);
 }finally{await p.close();}
});
test('native QR image is authenticated, scoped and unchanged images keep their ETag',async()=>{
 const png=Buffer.from('fixture-png');const adapter={status:()=>({}),qr:()=>null,qrImage:()=> 'data:image/png;base64,'+png.toString('base64')};
 const p=await startSessionPanel({adapter,port:0,qrToSvg:async()=>{throw Error('Must preserve native image');}});
 try{
  assert.equal((await fetch(p.origin+'/api/qr')).status,401);
  const r=await fetch(p.origin+'/api/qr',{headers:headers(p)});assert.equal(r.headers.get('content-type'),'image/png');
  assert.deepEqual(Buffer.from(await r.arrayBuffer()),png);
  const unchanged=await fetch(p.origin+'/api/qr',{headers:{...headers(p),'If-None-Match':r.headers.get('etag')}});assert.equal(unchanged.status,304);
 }finally{await p.close();}
});
test('unchanged QR returns 304 so the screen keeps its existing image',()=>fixture(async p=>{
  const first=await fetch(p.origin+'/api/qr',{headers:headers(p)});const tag=first.headers.get('etag');await first.text();
  assert.ok(tag);
  const repeat=await fetch(p.origin+'/api/qr',{headers:{...headers(p),'If-None-Match':tag}});
  assert.equal(repeat.status,304);assert.equal(await repeat.text(),'');
}));
test('public page contains no QR or credential and prohibits caching/framing',()=>fixture(async p=>{
  const r=await fetch(p.origin+'/');const html=await r.text();assert.equal(r.status,200);
  const script=html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)?.[1];assert.ok(script);assert.doesNotThrow(()=>new Script(script));
  assert.equal(html.includes(p.token),false);assert.equal(html.includes('private-QR'),false);
  assert.equal(r.headers.get('cache-control'),'no-store');assert.match(r.headers.get('content-security-policy'),/frame-ancestors 'none'/);
}));
test('chat reading and sending require the same private token',async()=>{
  let read=0;
  const p=await startSessionPanel({adapter:{status:()=>({}),qr:()=>null},port:0,qrToSvg:async()=>'',chatReader:{
    list:async()=>({chats:[],total:0}),messages:async id=>{read++;return {id,messages:[]};},assertSendable:async()=>({group:false}),
  },});
  try{
    assert.equal((await fetch(p.origin+'/api/chats')).status,401);
    assert.equal((await fetch(p.origin+'/api/chats/1234567%40c.us')).status,401);assert.equal(read,0);
    const r=await fetch(p.origin+'/api/chats/1234567%40c.us',{headers:headers(p)});assert.equal(r.status,200);assert.equal((await r.json()).id,'1234567@c.us');
    assert.equal((await fetch(p.origin+'/api/chats?offset=-1',{headers:headers(p)})).status,400);
    assert.equal((await fetch(p.origin+'/api/send',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
  }finally{await p.close();}
});
test('manual send uses selected line, validates an existing chat, and rejects malformed payloads',async()=>{
  const sent=[];const adapter={status:()=>({lineKey:'WA-primary'}),qr:()=>null,sendManual:async job=>{await job.authorizeTarget(job.chatId);sent.push(job);return {state:'accepted',providerId:'provider-1'};}};
  const other={adapter:{...adapter,status:()=>({lineKey:'WA-other'})},chatReader:{assertSendable:async id=>{if(id!=='1234567@g.us')throw Error();return {group:true};}}};
  const lineManager={get:key=>{if(key!=='WA-other')throw Error();return other;}};
  const reader={assertSendable:async id=>{if(id!=='1234567@c.us')throw Error();return {group:false};}};
  const p=await startSessionPanel({adapter,lineManager,chatReader:reader,port:0,qrToSvg:async()=>''});
  try{
    const post=body=>fetch(p.origin+'/api/send?line=WA-other',{method:'POST',headers:{...headers(p),'Content-Type':'application/json'},body:JSON.stringify(body)});
    assert.equal((await post({request_id:randomUUID(),chat_id:'1234567@c.us',text:'Hola'})).status,400);assert.equal(sent.length,0);
    assert.equal((await post({request_id:'bad',chat_id:'1234567@g.us',text:'Hola'})).status,400);
    const body={request_id:randomUUID(),chat_id:'1234567@g.us',text:'Mensaje de grupo'};const response=await post(body);
    assert.equal(response.status,200);assert.deepEqual((({authorizeTarget,...rest})=>rest)(sent[0]),{requestId:body.request_id,chatId:body.chat_id,body:body.text});
    assert.equal(await sent[0].authorizeTarget(body.chat_id),true);assert.equal((await post({...body,text:'x'.repeat(4001)})).status,400);
    assert.equal((await fetch(p.origin+'/api/send?line=WA-other',{method:'POST',headers:{...headers(p),'Content-Type':'text/plain'},body:'{}'})).status,415);
    assert.equal((await fetch(p.origin+'/api/send?line=WA-other',{method:'POST',headers:{...headers(p),'Content-Type':'application/json'},body:'x'.repeat(8193)})).status,413);
  }finally{await p.close();}
});
test('send route refuses redirects, foreign origins and unknown lines',()=>fixture(async p=>{
  const body=JSON.stringify({request_id:randomUUID(),chat_id:'1234567@c.us',text:'Hola'});
  assert.equal((await fetch(p.origin+'/api/send',{method:'POST',headers:{...headers(p),Origin:'https://external.example.test','Content-Type':'application/json'},body})).status,403);
  assert.equal((await fetch(p.origin+'/api/send?line=missing',{method:'POST',headers:{...headers(p),'Content-Type':'application/json'},body})).status,404);
}));
test('private status and QR require a header token, never a query-string token',()=>fixture(async p=>{
  for(const path of ['/api/status','/api/qr','/api/status?token='+p.token]) assert.equal((await fetch(p.origin+path)).status,401);
  assert.equal((await fetch(p.origin+'/api/status',{headers:headers(p)})).status,200);
  const qr=await fetch(p.origin+'/api/qr',{headers:headers(p)});assert.equal(await qr.text(),'<svg>private-QR</svg>');
}));
test('cross-site requests and DNS rebinding host are rejected even with token',()=>fixture(async p=>{
  assert.equal((await fetch(p.origin+'/api/status',{headers:{...headers(p),Origin:'https://external.example.test'}})).status,403);
  // fetch normalizes Host; use a real raw HTTP request for the rebinding case.
  const status=await new Promise((resolve,reject)=>{
    const req=request(p.origin+'/api/status',{headers:{...headers(p),Host:'external.example.test'}},response=>{
      response.resume();resolve(response.statusCode);
    });req.on('error',reject);req.end();
  });
  assert.equal(status,403);
}));
test('panel adds no resume, logout or configuration mutation endpoint',()=>fixture(async p=>{
  for(const path of ['/resume','/logout']) {
    assert.equal((await fetch(p.origin+path,{method:'POST',headers:headers(p)})).status,405);
    assert.equal((await fetch(p.origin+path,{headers:headers(p)})).status,404);
  }
}));
test('stop requires the private token and invokes only the supplied local close action',async()=>{
  let called=0;
  const p=await startSessionPanel({adapter:{status:()=>({}),qr:()=>null},port:0,qrToSvg:async()=>'',onStop:()=>{called++;}});
  try {
    assert.equal((await fetch(p.origin+'/api/stop',{method:'POST'})).status,401);
    assert.equal((await fetch(p.origin+'/api/stop',{method:'POST',headers:headers(p)})).status,202);
    await new Promise(resolve=>setTimeout(resolve,100));assert.equal(called,1);
  } finally {await p.close();}
});
test('line management is authenticated and each read is routed to the selected runtime',async()=>{
  let registered=0,connected=0,stopped=0,unlinked=0;
  const adapter={status:()=>({lineKey:'WA-primary'}),qr:()=>null},other={adapter:{status:()=>({lineKey:'WA-other'}),qr:()=> 'other-QR'},chatReader:{list:async()=>({total:7}),messages:async id=>({id,line:'other'})}};
  const lineManager={list:()=>[{lineKey:'WA-primary'},{lineKey:'WA-other'}],get:key=>{if(key!=='WA-other')throw Error();return other;},register:async row=>{registered++;return row;},connect:async()=>{connected++;return {};},disconnect:async()=>{stopped++;return {profilePreserved:true};},unlink:async key=>{assert.equal(key,'WA-other');unlinked++;return{unlinked:true,historyPreserved:true};}};
  const p=await startSessionPanel({adapter,lineManager,port:0,qrToSvg:async x=>x});
  try{
    assert.equal((await fetch(p.origin+'/api/lines')).status,401);
    const post={method:'POST',headers:{...headers(p),'Content-Type':'application/json'},body:JSON.stringify({label:'Soporte'})};
    assert.equal((await fetch(p.origin+'/api/lines',{...post,headers:{'Content-Type':'application/json'}})).status,401);assert.equal(registered,0);
    assert.equal((await fetch(p.origin+'/api/lines',post)).status,201);assert.equal(registered,1);
    assert.equal((await fetch(p.origin+'/api/lines',{...post,body:'x'.repeat(1025)})).status,413);
    assert.equal((await fetch(p.origin+'/api/lines/WA-other/connect',post)).status,202);assert.equal(connected,1);
    assert.equal((await fetch(p.origin+'/api/lines/WA-other/stop',{method:'POST'})).status,401);assert.equal(stopped,0);
    assert.equal((await (await fetch(p.origin+'/api/lines/WA-other/stop',post)).json()).profilePreserved,true);assert.equal(stopped,1);
    const status=await (await fetch(p.origin+'/api/status?line=WA-other',{headers:headers(p)})).json();assert.equal(status.lineKey,'WA-other');
    assert.equal((await (await fetch(p.origin+'/api/chats?line=WA-other',{headers:headers(p)})).json()).total,7);
    assert.equal(await (await fetch(p.origin+'/api/qr?line=WA-other',{headers:headers(p)})).text(),'other-QR');
    assert.equal((await fetch(p.origin+'/api/status?line=WA-missing',{headers:headers(p)})).status,404);
    assert.equal((await fetch(p.origin+'/api/lines/WA-other/unlink',{method:'POST'})).status,401);
    assert.equal((await fetch(p.origin+'/api/lines/WA-other/unlink',{...post,body:'{}'})).status,400);assert.equal(unlinked,0);
    assert.equal((await fetch(p.origin+'/api/lines/WA-other/unlink',{...post,body:'{"confirmed":true}'})).status,200);assert.equal(unlinked,1);
  }finally{await p.close();}
});
