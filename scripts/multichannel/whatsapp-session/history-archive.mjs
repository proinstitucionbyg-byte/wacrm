import{readFile,open,mkdir}from'node:fs/promises';
import{dirname}from'node:path';
import{sessionScope}from'./store.mjs';
const chatPattern=/^\d{5,25}@(c\.us|lid|g\.us)$/;
export async function openHistoryArchive({accountId,lineKey,path,readOnly=false}){
 const scope=sessionScope(accountId,lineKey),chats=new Map(),messages=new Map();let seq=0,lastSaved=null,tail=Promise.resolve();
 function apply(value){
  if(!chatPattern.test(value.chat?.id??''))throw Error('Archivo de historial inválido.');
  chats.set(value.chat.id,value.chat);const existing=messages.get(value.chat.id)??new Map();
  for(const message of value.messages??[]){if(typeof message.id!=='string'||!message.id||typeof message.text!=='string')throw Error('Mensaje archivado inválido.');existing.set(message.id,message);}
  messages.set(value.chat.id,existing);
 }
 try{const text=await readFile(path,'utf8');if(text&&!text.endsWith('\n'))throw Error('Historial incompleto; no se sobrescribirá.');
  for(const line of text.split('\n').filter(Boolean)){const row=JSON.parse(line);if(row.scope!==scope||row.seq!==seq+1)throw Error('Historial de otra cuenta o línea.');apply(row.value);seq=row.seq;lastSaved=row.at;}
 }catch(error){if(error.code!=='ENOENT')throw error;}
 function save(chat,rows=[]){
  if(readOnly)return Promise.reject(Error('Historial de solo lectura.'));
  if(!chatPattern.test(chat.id??''))return Promise.reject(Error('Conversación inválida.'));
  const task=tail.then(async()=>{
   chat={...chats.get(chat.id),...chat};
   const old=messages.get(chat.id)??new Map(),fresh=rows.filter(row=>JSON.stringify(old.get(row.id))!==JSON.stringify(row));
   if(!fresh.length&&JSON.stringify(chats.get(chat.id))===JSON.stringify(chat))return;
   const value={chat,messages:fresh},at=new Date().toISOString();
   await mkdir(dirname(path),{recursive:true,mode:0o700});const file=await open(path,'a',0o600);
   try{await file.writeFile(JSON.stringify({scope,seq:seq+1,at,value})+'\n');await file.sync();}finally{await file.close();}
   apply(value);seq++;lastSaved=at;
  });tail=task.catch(()=>{});return task;
 }
 return Object.freeze({save,
  list({offset=0,limit=20,search='',kind='all'}={}){
   if(!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>50||typeof search!=='string'||search.length>100||!['all','groups'].includes(kind))throw Error('Filtro inválido.');
   const needle=search.trim().toLocaleLowerCase(),all=[...chats.values()].filter(row=>!row.locked&&(kind!=='groups'||row.group)&&(!needle||[row.name,row.id,row.phone].some(value=>String(value??'').toLocaleLowerCase().includes(needle)))).sort((a,b)=>(b.timestamp??0)-(a.timestamp??0));
   return{total:all.length,offset,limit,chats:all.slice(offset,offset+limit),archived:true,lastSaved};
  },
  thread(id){const chat=chats.get(id);if(!chat||chat.locked)throw Error('No hay historial guardado disponible para este chat.');return{id,name:chat.name,group:chat.group,phone:chat.phone,messages:[...(messages.get(id)?.values()??[])].sort((a,b)=>(a.timestamp??0)-(b.timestamp??0)),archived:true,lastSaved};},
  chat:id=>chats.get(id),
  export(){return{version:1,accountId,lineKey,lastSaved,chats:[...chats.values()].filter(row=>!row.locked).map(row=>({...row,messages:[...(messages.get(row.id)?.values()??[])]}))};},
  async idle(){await tail;},
 });
}

export function createArchivedReader({archive,reader,source,isReady}){
 let busy=null,lastCapture=0,lastError=false;
 const project=m=>({id:String(m.id?._serialized||'').slice(0,1024),own:m.fromMe===true||m.id?.fromMe===true,text:typeof m.body==='string'?m.body.slice(0,65536):'',type:String(m.type||'unknown').slice(0,32),hasMedia:m.hasMedia===true,timestamp:Number.isFinite(m.timestamp)?m.timestamp*1000:null});
 async function capture(){
  if(!source||!await isReady())return;if(busy)return busy;
  busy=(async()=>{
   const rows=await source.getChats({after:lastCapture?lastCapture-60000:0});
   for(const row of rows){const id=row.id?._serialized;if(!chatPattern.test(id??''))continue;
    const direct=/^(\d{7,15})@c\.us$/.exec(id)?.[1]??null,previous=archive.chat(id);
    await archive.save({id,name:String(row.name||'Conversación sin nombre').slice(0,160),group:row.isGroup===true,locked:row.isLocked===true,
     phone:row.isGroup?null:direct??previous?.phone??null,unread:Number.isSafeInteger(row.unreadCount)&&row.unreadCount>0?row.unreadCount:0,
     timestamp:Number.isFinite(row.timestamp)?row.timestamp*1000:null,preview:typeof row.lastMessage?.body==='string'?row.lastMessage.body.slice(0,200):''},row.isLocked?[]:(row.recentMessages??[]).map(project).filter(message=>message.id));
   }lastCapture=Date.now();lastError=false;
  })();try{await busy;}catch{lastError=true;}finally{busy=null;}
 }
 return Object.freeze({capture,
  async list(options){await capture();const result=archive.list(options);return{...result,offline:!await isReady(),archiveError:lastError};},
  async messages(id){
   if(await isReady()&&reader){const live=await reader.messages(id);await archive.save({...archive.chat(id),id,name:live.name,group:live.group,phone:live.phone,locked:false},live.messages.filter(message=>message.id));}
   return{...archive.thread(id),offline:!await isReady()};
  },
  async assertSendable(id){if(!reader||!await isReady())throw Error('La línea está desconectada; puedes consultar el historial, pero no enviar.');return reader.assertSendable(id);},
  async members(id){
   if(!/^\d{5,25}@g\.us$/.test(id??''))throw Error('Grupo inválido.');
   if(source?.getGroupParticipants&&await isReady()){
    await capture();const data=await source.getGroupParticipants(id),chat=archive.chat(id);
    if(!chat||chat.locked)throw Error('Grupo no disponible.');
    await archive.save({...chat,roster:{...data,savedAt:new Date().toISOString()}});
   }
   const chat=archive.chat(id);if(!chat||chat.locked||!chat.roster)throw Error('No hay una lista de participantes guardada para este grupo.');
   return{...chat.roster,offline:!await isReady(),complete:false};
  },
  async exportHistory(){await capture();return archive.export();},
  async close(){await busy?.catch(()=>{});await archive.idle();},
 });
}

export function participantCsv(data){
 const cell=value=>'"'+String(value??'').replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"';
 return '\uFEFF'+[['Telefono','Identificador WhatsApp','Administrador'],...data.participants.map(row=>[row.phone?'+'+row.phone:'',row.id,row.admin?'Sí':'No'])].map(row=>row.map(cell).join(',')).join('\r\n');
}

export async function archiveJournalMessage(archive,event){
 if(!chatPattern.test(event?.chatId??'')||typeof event.id!=='string'||!event.id||event.id.startsWith('manual:'))return;
 const previous=archive.chat(event.chatId),direct=/^(\d{7,15})@c\.us$/.exec(event.chatId)?.[1];
 await archive.save({...previous,id:event.chatId,name:previous?.name||event.chatId,phone:event.senderPhone??direct??previous?.phone??null,
  group:event.chatId.endsWith('@g.us'),locked:previous?.locked??false,timestamp:Math.max(event.timestamp??0,previous?.timestamp??0)||null,
  preview:(event.timestamp??0)>=(previous?.timestamp??0)?event.text?.slice(0,200)??'':previous?.preview??'',unread:previous?.unread??0},[{id:event.id,own:event.own===true,text:event.text??'',type:event.type??'chat',timestamp:event.timestamp??null,hasMedia:event.hasMedia===true}]);
}
