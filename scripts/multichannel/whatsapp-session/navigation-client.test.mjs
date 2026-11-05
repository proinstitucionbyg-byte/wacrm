import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { navigationSafeClient } from './navigation-client.mjs';
test('an empty media return is reconciled only to a unique new native receipt with the exact file proof, without resending',async()=>{
 let sends=0,reads=0;const provider={id:{_serialized:'true_verified-media',fromMe:true}};
 class Base extends EventEmitter{pupPage={evaluate:async(fn,proof)=>{if(!proof)return;assert.match(proof.filehash,/^[A-Za-z0-9+/]{43}=$/);return{chatId:'51900000002@c.us',ids:reads++?['true_old','true_verified-media']:['true_old']};}};async sendMessage(){sends++;return undefined;}async getMessageById(id){assert.equal(id,provider.id._serialized);return provider;}}
 const client=new(navigationSafeClient(Base))();assert.equal(await client.sendMessage('51900000002@c.us',{mimetype:'audio/ogg',data:'aGVsbG8='}),provider);assert.equal(sends,1);
});
test('several new media candidates remain uncertain and never trigger another send',async()=>{
 let sends=0,reads=0;class Base extends EventEmitter{pupPage={evaluate:async(fn,proof)=>proof?{chatId:'51900000002@c.us',ids:reads++?['true_one','true_two']:[]}:undefined};async sendMessage(){sends++;return undefined;}async getMessageById(){throw Error('Ambiguous receipt must not be selected');}}
 const client=new(navigationSafeClient(Base))();assert.equal(await client.sendMessage('51900000002@c.us',{mimetype:'audio/ogg',data:'aGVsbG8='}),undefined);assert.equal(sends,1);
});
test('an own LID is normalized only from the official paired phone, never its digits',async()=>{
 let paired=null;class Base extends EventEmitter{info={wid:{server:'lid',user:'123456789012345'}};pupPage={evaluate:async()=>paired};async getState(){return 'CONNECTED';}}
 const client=new(navigationSafeClient(Base))();await client.getState();assert.equal(client.info.wid.server,'lid');
 paired={user:'51900000001',server:'c.us',_serialized:'51900000001@c.us'};await client.getState();assert.equal(client.info.wid.user,'51900000001');assert.equal(client.info.wid.server,'c.us');
});
test('native QR remains available while waiting for a new linked socket',async()=>{
 const calls=[];let callback;
 class Base extends EventEmitter {options={};pupPage={
   exposeFunction:async(name,fn)=>{calls.push(name);callback=fn;},
   evaluate:async(fn,...args)=>{calls.push(args.length?'observe':'evaluate');return false;},
   waitForFunction:async(_,options)=>{assert.equal(options.timeout,0);callback('data:image/png;base64,aGVsbG8=');},
 };async inject(){calls.push('inject');}}
 const Client=navigationSafeClient(Base),client=new Client();let qr;client.on('qr_image',value=>{qr=value;});
 await client.inject();assert.equal(qr,'data:image/png;base64,aGVsbG8=');assert.ok(calls.includes('observe'));assert.equal(calls.at(-1),'inject');
});
test('waits for a navigation-safe page condition before vendor injection',async()=>{
  const events=[];
  class Base extends EventEmitter { options={authTimeoutMs:7000};pupPage={waitForFunction:async(condition,options)=>{
    events.push('ready');assert.match(condition,/VERSION/);assert.equal(options.timeout,7000);
  }};async inject(){events.push('inject');return 'done';} }
  const Client=navigationSafeClient(Base);assert.equal(await new Client().inject(),'done');assert.deepEqual(events,['ready','inject']);
});
test('a page timeout prevents partial vendor injection',async()=>{
  let injected=false;
  class Base extends EventEmitter {options={};pupPage={waitForFunction:async()=>{throw Error('timeout');}};async inject(){injected=true;} }
  const Client=navigationSafeClient(Base);await assert.rejects(new Client().inject());assert.equal(injected,false);
});
test('only initial navigation interruption is retried, with a strict limit',async()=>{
  let count=0;
  class Base extends EventEmitter {options={};pupPage={waitForFunction:async()=>{}};async inject(){count++;throw Error('Execution context was destroyed.');} }
  const Client=navigationSafeClient(Base),client=new Client();await assert.rejects(client.inject());assert.equal(count,3);
  count=0;client.emit('ready');await assert.rejects(client.inject());assert.equal(count,1);
});
test('a later navigation failure is reported without killing the panel process',async()=>{
  class Base extends EventEmitter {options={};pupPage={waitForFunction:async()=>{}};async initialize(){}async inject(){throw Error('Execution context was destroyed.');}}
  const Client=navigationSafeClient(Base),client=new Client();let reported=false;client.on('session_error',()=>{reported=true;});
  await client.initialize();await client.inject();assert.equal(reported,true);
});
