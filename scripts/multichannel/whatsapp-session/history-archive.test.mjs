import{test}from'node:test';import assert from'node:assert/strict';
import{mkdtemp,rm}from'node:fs/promises';import{join}from'node:path';import{tmpdir}from'node:os';
import{openHistoryArchive,createArchivedReader,archiveJournalMessage,participantCsv}from'./history-archive.mjs';
const accountId='11111111-1111-4111-8111-111111111111',lineKey='WA-demo',id='51900000001@c.us';
async function fixture(fn){const dir=await mkdtemp(join(tmpdir(),'wa-history-'));try{const options={accountId,lineKey,path:join(dir,'history.jsonl')};await fn(await openHistoryArchive(options),options);}finally{await rm(dir,{recursive:true,force:true});}}
test('all observed texts survive disconnect, runtime restart and explicit logout without replay',()=>fixture(async(archive,options)=>{
 let ready=true;const row={id:{_serialized:id},name:'Demo',timestamp:1,recentMessages:[{id:{_serialized:'message-one'},body:'Guardado',type:'chat',timestamp:1}]};
 const reader=createArchivedReader({archive,source:{getChats:async()=>[row]},isReady:async()=>ready});await reader.capture();ready=false;
 assert.equal((await reader.list()).chats[0].name,'Demo');assert.equal((await reader.messages(id)).messages[0].text,'Guardado');
 await assert.rejects(reader.assertSendable(id),/desconectada/);await reader.close();
 const offline=createArchivedReader({archive:await openHistoryArchive({...options,readOnly:true}),isReady:async()=>false});
 assert.equal((await offline.messages(id)).messages[0].text,'Guardado');assert.equal((await offline.exportHistory()).lineKey,lineKey);
 await assert.rejects(openHistoryArchive({...options,lineKey:'WA-other'}),/otra cuenta o línea/);
}));
test('incremental snapshots do not delete older messages and locked chats stay hidden',()=>fixture(async archive=>{
 const chat={id,name:'Demo',group:false,locked:false};await archive.save(chat,[{id:'one',text:'Uno',timestamp:1}]);await archive.save(chat,[{id:'two',text:'Dos',timestamp:2}]);
 assert.equal(archive.thread(id).messages.length,2);await archive.save({...chat,locked:true});assert.equal(archive.list().total,0);assert.throws(()=>archive.thread(id));assert.equal(archive.export().chats.length,0);
}));
test('a received journal message is retained even when WhatsApp disconnects before the next snapshot',()=>fixture(async archive=>{
 await archiveJournalMessage(archive,{id:'inbound-real',chatId:id,text:'Llegó antes de perder conexión',timestamp:1,own:false,type:'chat'});
 assert.equal(archive.thread(id).messages[0].text,'Llegó antes de perder conexión');
 await archiveJournalMessage(archive,{id:'manual:uncertain',chatId:id,text:'No confirmado',own:true});assert.equal(archive.thread(id).messages.length,1);
}));
test('a group roster survives later snapshots and offline export escapes spreadsheet formulas',()=>fixture(async archive=>{
 const group='123456789@g.us';const chat={id:group,name:'Grupo',group:true,locked:false};
 await archive.save({...chat,roster:{id:group,loadedCount:1,participants:[{id:'51900000001@c.us',phone:'51900000001',admin:false}]}});await archive.save({...chat,preview:'Otro mensaje'});
 const reader=createArchivedReader({archive,isReady:async()=>false}),data=await reader.members(group);assert.equal(data.participants.length,1);assert.equal(data.offline,true);
 assert.match(participantCsv(data),/"'\+51900000001"/);await assert.rejects(reader.members(id));
}));
