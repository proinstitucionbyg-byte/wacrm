import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {createCachedChatSource} from './cached-chat-source.mjs';
import {createInboundPoller} from './inbound-poller.mjs';

function fixture(){
  const messages=Array.from({length:50},(_,i)=>({id:{_serialized:String(i),fromMe:i%2===0},
    from:i%2===0?'51900000099@c.us':'51900000001@c.us',to:i%2===0?'51900000001@c.us':'51900000099@c.us',
    body:'Ejemplo '+i,type:'chat',t:i}));
  const chat={id:{_serialized:'51900000001@c.us'},formattedTitle:'Ejemplo',t:50,unreadCount:2,
    msgs:{getModelsArray:()=>messages},serialize:()=>{throw Error('No enriquecer modelos');}};
  const client={pupPage:{evaluate:async(fn,args)=>runInNewContext('('+fn.toString()+')(args)',{args,window:{require:name=>{
    assert.equal(name,'WAWebCollections');return {Chat:{getModelsArray:()=>[chat]}};
  }}})}};
  return {client,chat,messages,source:createCachedChatSource(client)};
}
test('waits for the session browser instead of requiring it at construction',async()=>{
  const client={},source=createCachedChatSource(client);await assert.rejects(source.getChats(),/navegador/);
  client.pupPage=fixture().client.pupPage;assert.equal((await source.getChats()).length,1);
});
test('reads only the chosen unlocked group and never turns opaque LIDs into phone numbers',async()=>{
 const x=fixture();x.chat.id={_serialized:'123456789@g.us'};x.chat.groupMetadata={participants:{getModelsArray:()=>[{id:{_serialized:'51900000001@c.us'},isAdmin:true},{id:{_serialized:'123456789012@lid'}}]}};
 const data=await x.source.getGroupParticipants('123456789@g.us');assert.equal(data.loadedCount,2);assert.equal(data.participants[0].phone,'51900000001');assert.equal(data.participants[1].phone,null);
 await assert.rejects(x.source.getGroupParticipants('51900000001@c.us'));x.chat.isLocked=true;await assert.rejects(x.source.getGroupParticipants('123456789@g.us'));
});
test('reads loaded models without the failing vendor enrichment',async()=>{
  const x=fixture(),chats=await x.source.getChats();assert.equal(chats[0].name,'Ejemplo');
  assert.equal(chats[0].lastMessage.id._serialized,'49');
  assert.equal(chats[0].lastMessage.from,'51900000001@c.us');
  assert.equal(chats[0].lastMessage.timestamp,49);
  const messages=await chats[0].fetchMessages({limit:40});assert.equal(messages.length,40);
  assert.equal(messages[0].body,'Ejemplo 10');assert.equal(messages[0].fromMe,true);
});
test('inbound polling consumes the same safe loaded-chat projection as the reader',async()=>{
  const x=fixture(),captured=[];
  const poller=createInboundPoller({client:x.source,onMessage:message=>captured.push(message),
    isReady:async()=>true,startedAt:48_000,now:()=>100_000});
  assert.equal(await poller.pollOnce(),1);
  assert.equal(captured[0].id._serialized,'49');
  assert.equal(captured[0].from,'51900000001@c.us');
  poller.stop();
});
test('reads current WhatsApp message IDs that expose toString instead of _serialized',async()=>{
  const x=fixture(),captured=[];
  x.messages.at(-1).id={fromMe:false,toString:()=> 'false_51900000001@c.us_NEW'};
  const chats=await x.source.getChats({after:48_000});
  assert.equal(chats[0].recentMessages[0].id._serialized,'false_51900000001@c.us_NEW');
  assert.equal((await chats[0].fetchMessages({limit:1}))[0].id._serialized,'false_51900000001@c.us_NEW');
  const poller=createInboundPoller({client:x.source,onMessage:m=>captured.push(m),isReady:async()=>true,startedAt:48_000,now:()=>100_000});
  assert.equal(await poller.pollOnce(),1);assert.equal(await poller.pollOnce(),0);assert.equal(captured.length,1);poller.stop();
});
test('inbound polling recovers every recent cached message even when a later outgoing message is newest',async()=>{
  const x=fixture(),captured=[];x.messages.at(-1).id.fromMe=true;
  const poller=createInboundPoller({client:x.source,onMessage:message=>captured.push(message),
    isReady:async()=>true,startedAt:35_000,now:()=>100_000});
  assert.equal(await poller.pollOnce(),6);
  assert.deepEqual(captured.map(message=>message.id._serialized),['37','39','41','43','45','47']);
  assert.equal(await poller.pollOnce(),0);
  poller.stop();
});
test('one broken chat message cache does not hide other chats or their inbound messages',async()=>{
  const x=fixture(),captured=[];
  const broken={id:{_serialized:'51900000002@c.us'},formattedTitle:'No disponible',t:51,
    msgs:{getModelsArray(){throw Object.assign(Error('private'),{name:'DataError'});}}};
  x.client.pupPage.evaluate=async(fn,args)=>runInNewContext('('+fn.toString()+')(args)',{args,window:{require:name=>{
    assert.equal(name,'WAWebCollections');return {Chat:{getModelsArray:()=>[broken,x.chat]}};
  }}});
  const chats=await x.source.getChats({after:48_000});
  assert.equal(chats.length,2);
  assert.equal(chats[0].lastMessage,null);
  assert.equal(chats[0].recentMessages.length,0);
  const poller=createInboundPoller({client:x.source,onMessage:message=>captured.push(message),
    isReady:async()=>true,startedAt:48_000,now:()=>100_000});
  assert.equal(await poller.pollOnce(),1);
  assert.equal(captured[0].id._serialized,'49');
  assert.equal(poller.status().errors,0);
  poller.stop();
});
test('rechecks locked state immediately before reading messages',async()=>{
  const x=fixture(),chats=await x.source.getChats();x.chat.isLocked=true;
  await assert.rejects(chats[0].fetchMessages({limit:40}),/no disponible/);
});
test('does not include notification events among conversation messages',async()=>{
  const x=fixture();x.messages.at(-1).isNotification=true;
  const chats=await x.source.getChats(),messages=await chats[0].fetchMessages({limit:40});
  assert.equal(messages.at(-1).id._serialized,'48');
});
test('shows media captions instead of exposing binary thumbnail bodies',async()=>{
  const x=fixture();Object.assign(x.messages.at(-1),{type:'image',body:'PRIVATE_BINARY_THUMBNAIL',caption:'Descripción'});
  const chats=await x.source.getChats(),messages=await chats[0].fetchMessages({limit:40});
  assert.equal(messages.at(-1).body,'Descripción');assert.ok(!JSON.stringify(messages).includes('PRIVATE_BINARY'));
});
test('messages appear in timestamp order and exclude system group notifications',async()=>{
  const x=fixture();x.messages[0].type='gp2';x.messages.reverse();
  const chats=await x.source.getChats(),messages=await chats[0].fetchMessages({limit:40});
  assert.equal(messages.at(-1).timestamp,49);assert.equal(messages[0].timestamp,10);
});
