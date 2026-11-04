/** Read-only projection of already loaded models. The vendor's getChats()
 * enriches every group/last-message through IndexedDB; one DataError there
 * can reject the entire list. The viewer and inbound recovery need only these
 * already-loaded fields. */
export function createCachedChatSource(client) {
  if(!client)throw Error('Falta el cliente de esta sesión.');
  return {
    async getGroupParticipants(chatId){
      if(!/^\d{5,25}@g\.us$/.test(chatId??'')||!client.pupPage?.evaluate)throw Error('Grupo no disponible.');
      return client.pupPage.evaluate(id=>{
        const serialize=value=>typeof value==='string'?value:typeof value?._serialized==='string'?value._serialized:value?.toString?.();
        const chat=window.require('WAWebCollections').Chat.getModelsArray().find(row=>serialize(row.id)===id);
        if(!chat?.groupMetadata||chat.isLocked===true)throw Error('Grupo no disponible.');
        const collection=chat.groupMetadata.participants;
        const models=Array.isArray(collection)?collection:collection?.getModelsArray?.();
        if(!Array.isArray(models)||models.length>5000)throw Error('Participantes todavía no cargados.');
        return {id,name:String(chat.formattedTitle||'Grupo').slice(0,160),loadedCount:models.length,participants:models.flatMap(row=>{
          const key=serialize(row.id);if(typeof key!=='string'||!/^\d{5,25}@(c\.us|lid)$/.test(key))return[];
          let phone=/^(\d{7,15})@c\.us$/.exec(key)?.[1]??null;
          if(!phone&&key.endsWith('@lid')){try{
            const paired=window.require('WAWebApiContact').getPhoneNumber(window.require('WAWebWidFactory').createWid(key));
            if(paired?.server==='c.us'&&/^\d{7,15}$/.test(paired.user??''))phone=paired.user;
          }catch{/* An unavailable verified mapping stays unresolved; never reinterpret the LID digits. */}}
          return[{id:key,phone,admin:row.isAdmin===true||row.isSuperAdmin===true}];
        })};
      },chatId);
    },
    async getChats({ after } = {}) {
      if(!client.pupPage?.evaluate)throw Error('Falta el navegador de esta sesión.');
      const rows=await client.pupPage.evaluate(({after})=>{
        const chats=window.require('WAWebCollections').Chat.getModelsArray();
        const serialize=value=>{
          if(typeof value==='string')return value;
          if(typeof value?._serialized==='string')return value._serialized;
          const text=value?.toString?.();
          return typeof text==='string'&&/^(?:\d+@(c\.us|lid|g\.us)|(?:true|false)_.+)$/.test(text)?text:null;
        };
        const projectMessage=message=>{
          const fromMe=message?.id?.fromMe===true;
          return {id:{_serialized:serialize(message?.id),fromMe},fromMe,
            from:serialize(message?.from)??(!fromMe?message?.chat?.id?._serialized:null),
            to:serialize(message?.to)??(fromMe?message?.chat?.id?._serialized:null),
            body:(message?.mediaData||message?.mediaObject||message?.directPath||['image','video','audio','ptt','document','sticker'].includes(message?.type))
              ?message?.caption??'' : message?.body??message?.pollName??message?.eventName??'',
            type:message?.type,timestamp:message?.t,hasMedia:!!(message?.mediaData||message?.mediaObject||message?.directPath)};
        };
        return chats.flatMap(chat=>{
          let row;
          try {
            const id=serialize(chat.id);
            if(typeof id!=='string'||!id)return [];
            row={id,name:chat.formattedTitle,isGroup:!!chat.groupMetadata,
              isLocked:chat.isLocked===true,timestamp:chat.t,unreadCount:chat.unreadCount,lastMessage:null};
          } catch { return []; }
          try {
            const messages=chat.msgs?.getModelsArray?.()??[];
            const visible=messages.filter(message=>!message.isNotification&&!['gp2','e2e_notification'].includes(message.type));
            const last=visible.reduce((latest,message)=>!latest||Number(message.t)>Number(latest.t)?message:latest,null);
            if(last)row.lastMessage={...projectMessage(last),
              from:serialize(last.from)??(!last.id?.fromMe?row.id:null),
              to:serialize(last.to)??(last.id?.fromMe?row.id:null)};
            if(Number.isFinite(after))row.recentMessages=visible.filter(message=>Number(message.t)*1000>after).map(projectMessage);
          } catch {
            // One malformed/unavailable message collection must not hide every chat.
            if(Number.isFinite(after))row.recentMessages=[];
          }
          return [row];
        });
      },{after:Number.isFinite(after)?after:null});
      return rows.map(row=>({...row,id:{_serialized:row.id},fetchMessages:async({limit})=>{
        return client.pupPage.evaluate(({chatId,limit})=>{
          const serialize=value=>typeof value==='string'?value:typeof value?._serialized==='string'?value._serialized:
            /^(?:\d+@(c\.us|lid|g\.us)|(?:true|false)_.+)$/.test(value?.toString?.()??'')?value.toString():null;
          const chat=window.require('WAWebCollections').Chat.getModelsArray().find(c=>serialize(c.id)===chatId);
          if(!chat||chat.isLocked===true)throw Error('Conversación no disponible.');
          return chat.msgs.getModelsArray().filter(m=>!m.isNotification&&!['gp2','e2e_notification'].includes(m.type))
            .slice().sort((a,b)=>(Number(a.t)||0)-(Number(b.t)||0)).slice(-limit).map(m=>({
            id:{_serialized:serialize(m.id),fromMe:m.id?.fromMe===true},fromMe:m.id?.fromMe===true,
            body:(m.mediaData||m.mediaObject||m.directPath||['image','video','audio','ptt','document','sticker'].includes(m.type))
              ? m.caption??'' : m.body??m.pollName??m.eventName??'',
            type:m.type,timestamp:m.t,hasMedia:!!(m.mediaData||m.mediaObject||m.directPath),
          }));
        },{chatId:row.id,limit});
      }}));
    },
  };
}
