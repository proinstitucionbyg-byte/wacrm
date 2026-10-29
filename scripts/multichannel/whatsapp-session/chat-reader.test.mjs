import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createChatReader} from './chat-reader.mjs';
function fixture(){
  let ready=true,calls=0,messageLimit;
  const chat={id:{_serialized:'51900000002@c.us'},name:'FICTICIO',timestamp:100,unreadCount:2,lastMessage:{body:'Texto de ejemplo'},
    fetchMessages:async options=>{messageLimit=options.limit;return [{id:{_serialized:'example',fromMe:false},body:'<script>no ejecutar</script>',type:'chat',timestamp:90}];}};
  const chats=[chat,{...chat,id:{_serialized:'123456789@g.us'},isGroup:true}, {...chat,id:{_serialized:'51900000003@c.us'},isLocked:true}, {...chat,id:{_serialized:'status@broadcast'}}];
  const reader=createChatReader({client:{getChats:async()=>{calls++;return chats;}},isReady:async()=>ready});
  return {reader,chat,chats,setReady:x=>{ready=x;},calls:()=>calls,limit:()=>messageLimit};
}
test('lists only existing unlocked individual/group chats with a bounded page',async()=>{
  const x=fixture(),page=await x.reader.list({limit:1});assert.equal(page.total,2);assert.equal(page.chats.length,1);assert.equal(page.chats[0].name,'FICTICIO');
});
test('disconnected session does not read or disclose cached history',async()=>{
  const x=fixture();x.setReady(false);await assert.rejects(x.reader.list());assert.equal(x.calls(),0);
});
test('unknown chat cannot be used to discover a new recipient',async()=>{
  const x=fixture();await assert.rejects(x.reader.messages('51900000009@c.us'),/no disponible/);
});
test('locked chats are not readable through a direct URL',async()=>{
  const x=fixture();await assert.rejects(x.reader.messages('51900000003@c.us'),/no disponible/);
});
test('history is limited to forty messages and returns text as data',async()=>{
  const x=fixture(),history=await x.reader.messages('51900000002@c.us');assert.equal(x.limit(),40);assert.equal(history.group,false);
  assert.equal(history.messages[0].text,'<script>no ejecutar</script>');assert.equal(history.messages[0].own,false);
});
test('manual sending is allowed only to a currently listed unlocked chat or group',async()=>{
  const x=fixture();assert.deepEqual(await x.reader.assertSendable('51900000002@c.us'),{group:false,name:'FICTICIO'});
  assert.equal((await x.reader.assertSendable('123456789@g.us')).group,true);
  await assert.rejects(x.reader.assertSendable('51900000009@c.us'),/no disponible/);
  await assert.rejects(x.reader.assertSendable('51900000003@c.us'),/no disponible/);
});
test('a connection lost during a read does not return its data',async()=>{
  const x=fixture();x.chat.fetchMessages=async()=>{x.setReady(false);return [];};
  await assert.rejects(x.reader.messages('51900000002@c.us'));
});
test('bad pages and broadcast targets are rejected before reading',async()=>{
  const x=fixture();await assert.rejects(x.reader.list({limit:10000}));await assert.rejects(x.reader.messages('status@broadcast'));assert.equal(x.calls(),0);
});
test('search and group filters run before pagination, including later matches',async()=>{
  const x=fixture();x.chats.push({...x.chat,id:{_serialized:'51900000008@c.us'},name:'Soporte lejano'});
  const page=await x.reader.list({search:'lejano',limit:1});assert.equal(page.total,1);assert.equal(page.chats[0].name,'Soporte lejano');
  assert.equal((await x.reader.list({kind:'groups'})).total,1);
  await assert.rejects(x.reader.list({search:'x'.repeat(101)}));
});
