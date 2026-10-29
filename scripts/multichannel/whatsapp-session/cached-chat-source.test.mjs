import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {createCachedChatSource} from './cached-chat-source.mjs';

function fixture(){
  const messages=Array.from({length:50},(_,i)=>({id:{_serialized:String(i),fromMe:i%2===0},body:'Ejemplo '+i,type:'chat',t:i}));
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
test('reads loaded models without the failing vendor enrichment',async()=>{
  const x=fixture(),chats=await x.source.getChats();assert.equal(chats[0].name,'Ejemplo');
  const messages=await chats[0].fetchMessages({limit:40});assert.equal(messages.length,40);
  assert.equal(messages[0].body,'Ejemplo 10');assert.equal(messages[0].fromMe,true);
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
