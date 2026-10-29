/** Read-only projection of already loaded models. The vendor's getChats()
 * enriches every group/last-message through IndexedDB; one DataError there
 * can reject the entire list. This viewer does not need that enrichment. */
export function createCachedChatSource(client) {
  if(!client)throw Error('Falta el cliente de esta sesión.');
  return {
    async getChats() {
      if(!client.pupPage?.evaluate)throw Error('Falta el navegador de esta sesión.');
      const rows=await client.pupPage.evaluate(()=>{
        const chats=window.require('WAWebCollections').Chat.getModelsArray();
        return chats.map(chat=>({id:chat.id?._serialized,name:chat.formattedTitle,
          isGroup:!!chat.groupMetadata,isLocked:chat.isLocked===true,
          timestamp:chat.t,unreadCount:chat.unreadCount}));
      });
      return rows.map(row=>({...row,id:{_serialized:row.id},fetchMessages:async({limit})=>{
        return client.pupPage.evaluate(({chatId,limit})=>{
          const chat=window.require('WAWebCollections').Chat.getModelsArray().find(c=>c.id?._serialized===chatId);
          if(!chat||chat.isLocked===true)throw Error('Conversación no disponible.');
          return chat.msgs.getModelsArray().filter(m=>!m.isNotification&&!['gp2','e2e_notification'].includes(m.type))
            .slice().sort((a,b)=>(Number(a.t)||0)-(Number(b.t)||0)).slice(-limit).map(m=>({
            id:{_serialized:m.id?._serialized,fromMe:m.id?.fromMe===true},fromMe:m.id?.fromMe===true,
            body:(m.mediaData||m.mediaObject||m.directPath||['image','video','audio','ptt','document','sticker'].includes(m.type))
              ? m.caption??'' : m.body??m.pollName??m.eventName??'',
            type:m.type,timestamp:m.t,hasMedia:!!(m.mediaData||m.mediaObject||m.directPath),
          }));
        },{chatId:row.id,limit});
      }}));
    },
  };
}
