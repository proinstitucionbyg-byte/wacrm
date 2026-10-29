import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { navigationSafeClient } from './navigation-client.mjs';
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
