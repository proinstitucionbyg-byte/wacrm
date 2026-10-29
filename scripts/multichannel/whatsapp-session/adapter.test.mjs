import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createSessionAdapter, replyBodyHash } from './adapter.mjs';
import { sessionScope } from './store.mjs';

const accountId=randomUUID(),lineKey='WA-fictional',phone='51900000001',chatId='51900000002@c.us';
function message(id='inbound-one', own=false, chat=chatId) {
  return {id:{_serialized:id,fromMe:own},fromMe:own,from:own?phone+'@c.us':chat,to:own?chat:phone+'@c.us',
    body:'Mensaje ficticio',type:'chat',timestamp:Math.floor(Date.now()/1000)};
}
function setup({rows=[],enabled=true,repliesEnabled=true,policy,expectedPhone,onInbound,resolveSenderPhone}={}) {
  const records=structuredClone(rows), client=new EventEmitter(); client.info={wid:{user:phone}};
  let sent=0,destroyed=0;
  client.initialize=async()=>{}; client.destroy=async()=>{destroyed++;};
  client.getState=async()=> 'CONNECTED';
  client.sendMessage=async(chat,body)=>{sent++;const m={...message('bot-'+sent,true,chat),body};client.emit('message_create',m);return m;};
  const store={scope:sessionScope(accountId,lineKey),records:()=>structuredClone(records),
    append:async(kind,payload)=>{records.push({kind,payload:structuredClone(payload)});},close:async()=>{}};
  let permitCalls=0;
  const authorizeReply=async job=>{permitCalls++;return policy?policy(job,permitCalls):{
    allowed:true,paused:false,permissionConfirmed:true,...job,expiresAt:Date.now()+5000};};
  const adapter=createSessionAdapter({accountId,lineKey,client,store,enabled,repliesEnabled,authorizeReply,onInbound,resolveSenderPhone,expectedPhone});
  return {adapter,client,store,records,sent:()=>sent,destroyed:()=>destroyed,permitCalls:()=>permitCalls};
}
async function ready(s){await s.adapter.start();s.client.emit('ready');await s.adapter.idle();}
async function inbound(s,id='inbound-one',chat=chatId){s.client.emit('message_create',message(id,false,chat));await s.adapter.idle();}
const job=(key='job-one')=>({key,accountId,lineKey,chatId,inboundId:'inbound-one',body:'Respuesta ficticia'});

test('disabled adapter never initializes a WhatsApp session',async()=>{
  const s=setup({enabled:false});let started=false;s.client.initialize=async()=>{started=true;};
  assert.equal(await s.adapter.start(),'disabled');assert.equal(started,false);
});
test('initialization failure closes the client and exposes only a classified reason',async()=>{
  const s=setup();s.client.initialize=async()=>{throw Error('Execution context was destroyed. private');};
  await s.adapter.start();assert.equal(s.adapter.status().status,'connection_error');
  assert.equal(s.adapter.status().connectionReason,'navigation_interrupted');assert.equal(s.destroyed(),1);
  assert.equal(JSON.stringify(s.adapter.status()).includes('private'),false);
});
test('first connection binds one number and restart refuses a different number',async()=>{
  const first=setup();await ready(first);assert.equal(first.adapter.status().linkedPhone,phone);
  const second=setup({rows:first.records});second.client.info.wid.user='51900000003';await ready(second);
  assert.equal(second.adapter.status().status,'wrong_number');assert.equal(second.destroyed(),1);
});
test('an explicitly expected number is enforced before reading',async()=>{
  const s=setup({expectedPhone:'51900000003'});await ready(s);await inbound(s);
  assert.equal(s.adapter.status().received,0);assert.equal(s.adapter.status().status,'wrong_number');
});
test('groups, broadcasts and duplicate events never become reply targets',async()=>{
  const s=setup();await ready(s);await inbound(s);await inbound(s);
  await inbound(s,'group','120000@g.us');await inbound(s,'status','status@broadcast');
  assert.equal(s.adapter.status().received,1);assert.equal(s.records.filter(r=>r.kind==='inbound').length,1);
});
test('the inbound message event is journaled and de-duplicated against message_create',async()=>{
  const s=setup();await ready(s);const incoming=message('message-event');
  s.client.emit('message',incoming);s.client.emit('message_create',incoming);await s.adapter.idle();
  assert.equal(s.adapter.status().received,1);
  assert.equal(s.records.filter(r=>r.kind==='inbound').length,1);
});
test('opaque LID is preserved without inventing a phone',async()=>{
  const s=setup();await ready(s);await inbound(s,'lid','123456789012345@lid');
  assert.equal(s.adapter.status().recent[0].chatId,'123456789012345@lid');
});
test('verified LID mapping reaches CRM and authorizes the matching phone-addressed reply',async()=>{
  const lid='123456789012345@lid';let received;
  const s=setup({resolveSenderPhone:async id=>id===lid?'51900000002':null,onInbound:async event=>{received=event;return {state:'synced'};}});
  await ready(s);await inbound(s,'lid-inbound',lid);
  assert.equal(received.senderPhone,'51900000002');
  assert.equal(s.records.find(r=>r.kind==='inbound').payload.senderPhone,'51900000002');
  const result=await s.adapter.dispatch({...job('lid-reply'),chatId:'51900000002@c.us',inboundId:'lid-inbound'});
  assert.equal(result.state,'accepted');assert.equal(s.sent(),1);
});
test('unresolved LID remains local and cannot be matched to a guessed phone',async()=>{
  const s=setup({resolveSenderPhone:async()=>null,onInbound:async()=>({state:'synced'})});await ready(s);await inbound(s,'unresolved','123456789012345@lid');
  assert.equal(s.records.find(r=>r.kind==='inbound').payload.senderPhone,undefined);
  assert.equal(s.adapter.status().centralSync.needsContactResolution,1);
});
test('incoming message alone cannot send any automatic response',async()=>{
  const s=setup();await ready(s);await inbound(s);assert.equal(s.sent(),0);
});
test('manual agent can send to an existing one-to-one chat or group; a human pause is saved',async()=>{
  const s=setup();await ready(s);await inbound(s);
  const id=randomUUID(), authorizeTarget=async target=>target===chatId||target==='123456789@g.us';
  const direct=await s.adapter.sendManual({requestId:id,chatId,body:'Respuesta humana',authorizeTarget});
  assert.equal(direct.state,'accepted');assert.equal(s.sent(),1);await s.adapter.idle();
  assert.equal((await s.adapter.dispatch(job('auto-after-human'))).state,'blocked');
  const group=await s.adapter.sendManual({requestId:randomUUID(),chatId:'123456789@g.us',body:'Aviso al grupo',authorizeTarget});
  assert.equal(group.state,'accepted');assert.equal(s.sent(),2);await s.adapter.idle();
  assert.equal(s.records.filter(r=>r.kind==='human').some(r=>r.payload.chatId==='123456789@g.us'),true);
  assert.equal(s.adapter.status().received,1); // Group messages never enter customer automation.
});
test('manual target validation can refresh the connection without deadlocking the send queue',async()=>{
  const s=setup();await ready(s);
  const result=await Promise.race([
    s.adapter.sendManual({requestId:randomUUID(),chatId,body:'Respuesta humana',
      authorizeTarget:async target=>{await s.adapter.refreshConnection();return target===chatId;}}),
    new Promise(resolve=>setTimeout(()=>resolve({state:'timed_out'}),500)),
  ]);
  assert.equal(result.state,'accepted');assert.equal(s.sent(),1);
});
test('manual send is idempotent and an uncertain outcome must be reviewed without retry',async()=>{
  const s=setup({repliesEnabled:false});await ready(s);const requestId=randomUUID(),input={requestId,chatId,body:'Mensaje humano',authorizeTarget:async()=>true};
  s.client.sendMessage=async()=>{s.sentCount=(s.sentCount??0)+1;throw Error('unknown outcome');};
  assert.equal((await s.adapter.sendManual(input)).state,'needs_review');
  assert.equal((await s.adapter.sendManual(input)).state,'already_attempted');assert.equal(s.sentCount,1);
  const restarted=setup({rows:s.records,repliesEnabled:false});await ready(restarted);
  assert.equal((await restarted.adapter.sendManual(input)).previous,'needs_review');assert.equal(restarted.sent(),0);
});
test('manual send refuses unknown chats and an already used request id with changed content',async()=>{
  const s=setup({repliesEnabled:false});await ready(s);const requestId=randomUUID();
  assert.equal((await s.adapter.sendManual({requestId,chatId,body:'Uno',authorizeTarget:async()=>false})).state,'blocked');
  const input={requestId,chatId,body:'Uno',authorizeTarget:async()=>true};assert.equal((await s.adapter.sendManual(input)).state,'accepted');
  assert.equal((await s.adapter.sendManual({...input,body:'Dos'})).state,'request_conflict');assert.equal(s.sent(),1);
});
test('optional CRM bridge stores an idempotent sync receipt without enabling replies',async()=>{
  const events=[];const s=setup({onInbound:async event=>{events.push(event);return {state:'synced'};}});
  await ready(s);await inbound(s);await s.adapter.syncPending();
  assert.equal(events.length,1);assert.equal(events[0].linkedPhone,phone);assert.equal(events[0].lineKey,lineKey);
  assert.equal(s.records.filter(row=>row.kind==='crm_sync').at(-1).payload.state,'synced');
  assert.equal(s.adapter.status().centralSync.synced,1);assert.equal(s.adapter.status().repliesEnabled,true);
  assert.equal(s.sent(),0);
});
test('a transient CRM failure is retried from the journal after restart',async()=>{
  const first=setup({onInbound:async()=>({state:'retry'})});await ready(first);await inbound(first);
  await first.adapter.syncPending();assert.equal(first.adapter.status().centralSync.retry,1);
  const retried=[];const second=setup({rows:first.records,onInbound:async event=>{retried.push(event.id);return {state:'synced'};}});
  await ready(second);await second.adapter.syncPending();
  assert.deepEqual(retried,['inbound-one']);assert.equal(second.adapter.status().centralSync.synced,1);
});
test('reply requires both explicit enablement and fresh matching policy',async()=>{
  const disabled=setup({repliesEnabled:false});await ready(disabled);await inbound(disabled);
  assert.equal((await disabled.adapter.dispatch(job())).state,'disabled');assert.equal(disabled.sent(),0);
  const denied=setup({policy:()=>({allowed:true,paused:false})});await ready(denied);await inbound(denied);
  assert.equal((await denied.adapter.dispatch(job())).state,'blocked');assert.equal(denied.sent(),0);
});
test('policy is rechecked after durable reservation and a late pause prevents send',async()=>{
  const s=setup({policy:(j,n)=>({allowed:n===1,paused:n!==1,permissionConfirmed:true,...j,expiresAt:Date.now()+5000})});
  await ready(s);await inbound(s);assert.equal((await s.adapter.dispatch(job())).state,'blocked');assert.equal(s.sent(),0);
  assert.equal(s.permitCalls(),2);assert.equal((await s.adapter.dispatch(job())).state,'already_attempted');
});
test('same key sends once, own bot echo does not cause human takeover, receipt is not delivery',async()=>{
  const s=setup();await ready(s);await inbound(s);
  assert.equal((await s.adapter.dispatch(job())).state,'accepted');await s.adapter.idle();
  assert.equal(s.adapter.status().pausedChats,0);assert.equal((await s.adapter.dispatch(job())).state,'already_attempted');assert.equal(s.sent(),1);
  s.client.emit('message_ack',message('bot-1',true),2);await s.adapter.idle();
  s.client.emit('message_ack',message('bot-1',true),0);await s.adapter.idle();
  assert.equal((await s.adapter.dispatch(job())).previous,'delivered');
});
test('a human response immediately blocks the next send and persists across restart',async()=>{
  const s=setup();await ready(s);await inbound(s);s.client.emit('message_create',message('human-one',true));
  assert.equal((await s.adapter.dispatch(job())).state,'blocked');await s.adapter.idle();
  const restarted=setup({rows:s.records});await ready(restarted);
  assert.equal((await restarted.adapter.dispatch(job('other'))).state,'blocked');assert.equal(restarted.sent(),0);
});
test('unknown send outcome remains reserved after restart, with no automatic resend',async()=>{
  const s=setup();await ready(s);await inbound(s);s.client.sendMessage=async()=>{throw Error('uncertain');};
  assert.equal((await s.adapter.dispatch(job())).state,'needs_review');
  const restarted=setup({rows:s.records});await ready(restarted);
  assert.equal((await restarted.adapter.dispatch(job())).state,'already_attempted');assert.equal(restarted.sent(),0);
});
test('write failure blocks the transport before sending',async()=>{
  const s=setup();await ready(s);await inbound(s);s.store.append=async()=>{throw Error('disk');};
  await assert.rejects(s.adapter.dispatch(job()));assert.equal(s.sent(),0);assert.equal(s.adapter.status().status,'storage_error');
});
test('wrong account, target or body proof cannot send',async()=>{
  const s=setup();await ready(s);await inbound(s);
  await assert.rejects(s.adapter.dispatch({...job(),accountId:randomUUID()}));
  assert.equal((await s.adapter.dispatch({...job(),chatId:'51900000003@c.us'})).state,'blocked');
  const p=setup({policy:j=>({allowed:true,paused:false,permissionConfirmed:true,...j,bodyHash:replyBodyHash('other'),expiresAt:Date.now()+5000})});
  await ready(p);await inbound(p);assert.equal((await p.adapter.dispatch(job())).state,'blocked');
});
test('disconnect clears QR, prevents sends, and never reconnects or logs out by itself',async()=>{
  const s=setup();await s.adapter.start();s.client.emit('qr','private-qr');assert.equal(s.adapter.qr(),'private-qr');
  s.client.emit('ready');await s.adapter.idle();await inbound(s);
  s.client.emit('disconnected');assert.equal(s.adapter.qr(),null);assert.equal((await s.adapter.dispatch(job())).state,'blocked');
});
test('a late QR cannot replace an already confirmed active session',async()=>{
  const s=setup();await ready(s);s.client.emit('qr','stale-qr');
  assert.equal(s.adapter.status().status,'ready');assert.equal(s.adapter.qr(),null);
});
test('live status reconciles a delayed navigation error without resuming human pauses',async()=>{
  const s=setup();await ready(s);s.client.emit('message_create',message('human-pause',true));await s.adapter.idle();
  s.client.emit('session_error');assert.equal(s.adapter.status().status,'connection_error');
  await s.adapter.refreshConnection();assert.equal(s.adapter.status().status,'ready');assert.equal(s.adapter.status().pausedChats,1);
  assert.equal((await s.adapter.dispatch(job())).state,'blocked');
});
test('stored number alone is never proof of a live connection',async()=>{
  const s=setup({rows:[{kind:'binding',payload:{phone}}]});await s.adapter.start();
  await s.adapter.refreshConnection();assert.notEqual(s.adapter.status().status,'ready');
  s.client.getState=async()=> 'UNPAIRED';s.client.emit('ready');await s.adapter.idle();assert.notEqual(s.adapter.status().status,'ready');
});
test('human action observed during policy lookup blocks the send immediately',async()=>{
  let s;
  s=setup({policy:j=>{s.client.emit('message_create',message('human-during-permit',true));return {allowed:true,paused:false,permissionConfirmed:true,...j,expiresAt:Date.now()+5000};}});
  await ready(s);await inbound(s);assert.equal((await s.adapter.dispatch(job())).state,'blocked');assert.equal(s.sent(),0);
});
test('receipt write failure after sending still prevents a second attempt after restart',async()=>{
  const s=setup();await ready(s);await inbound(s);const append=s.store.append;
  s.store.append=async(kind,payload)=>{if(kind==='result')throw Error('disk');return append(kind,payload);};
  await assert.rejects(s.adapter.dispatch(job()));assert.equal(s.sent(),1);
  const restarted=setup({rows:s.records});await ready(restarted);
  assert.equal((await restarted.adapter.dispatch(job())).state,'already_attempted');assert.equal(restarted.sent(),0);
});
