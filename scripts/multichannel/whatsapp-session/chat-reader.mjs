// Read-only view of chats already present in this isolated linked session.
// Historical reads never enter the inbound journal or response dispatcher.
const chatIdPattern = /^\d{5,25}@(c\.us|lid|g\.us)$/;
async function bounded(promise) {
  let timer;
  try { return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('La lectura de WhatsApp tardó demasiado.')),12_000);})]); }
  finally { clearTimeout(timer); }
}
export function createChatReader({client,isReady}) {
  if(!client?.getChats||!isReady)throw Error('Falta la sesión de lectura.');
  let known=new Map();
  const check=async()=>{if(!await isReady())throw Error('La sesión todavía no está lista.');};
  async function load() {
    await check();
    const chats=await bounded(client.getChats());
    await check();
    known=new Map(chats.filter(c=>chatIdPattern.test(c.id?._serialized??'')&&!c.isLocked).map(c=>[c.id._serialized,c]));
    return [...known.values()].sort((a,b)=>(Number(b.timestamp)||0)-(Number(a.timestamp)||0));
  }
  return Object.freeze({
    async list({offset=0,limit=20,search='',kind='all'}={}) {
      if(!Number.isInteger(offset)||offset<0||offset>50000||!Number.isInteger(limit)||limit<1||limit>50)throw Error('Página inválida.');
      if(typeof search!=='string'||search.length>100||!['all','groups'].includes(kind))throw Error('Filtro inválido.');
      const needle=search.trim().toLocaleLowerCase();
      const all=(await load()).filter(c=>(kind!=='groups'||c.isGroup===true)&&(!needle||String(c.name||'').toLocaleLowerCase().includes(needle)||c.id._serialized.includes(needle)));
      return {total:all.length,offset,limit,chats:all.slice(offset,offset+limit).map(c=>({
        id:c.id._serialized,name:String(c.name||'Conversación sin nombre').slice(0,160),group:c.isGroup===true,
        unread:Number.isSafeInteger(c.unreadCount)&&c.unreadCount>0?c.unreadCount:0,
        timestamp:Number.isFinite(c.timestamp)?c.timestamp*1000:null,
        preview:typeof c.lastMessage?.body==='string'?c.lastMessage.body.slice(0,200):'',
      }))};
    },
    async messages(chatId) {
      if(!chatIdPattern.test(chatId??''))throw Error('Conversación inválida.');
      await load(); // Refresh membership/lock state before each explicit read.
      const chat=known.get(chatId);
      if(!chat||chat.isLocked)throw Error('Conversación no disponible en esta sesión.');
      const messages=await bounded(chat.fetchMessages({limit:40}));
      await check();
      return {id:chatId,name:String(chat.name||'Conversación sin nombre').slice(0,160),group:chat.isGroup===true,
        messages:messages.map(m=>({id:String(m.id?._serialized||'').slice(0,1024),own:m.fromMe===true||m.id?.fromMe===true,
          text:typeof m.body==='string'?m.body.slice(0,65536):'',type:String(m.type||'unknown').slice(0,32),
          hasMedia:m.hasMedia===true,timestamp:Number.isFinite(m.timestamp)?m.timestamp*1000:null,
        }))};
    },
    async assertSendable(chatId) {
      if(!chatIdPattern.test(chatId??''))throw Error('Conversación inválida.');
      await load();
      const chat=known.get(chatId);
      if(!chat||chat.isLocked)throw Error('Conversación no disponible para enviar desde esta sesión.');
      return {group:chat.isGroup===true,name:String(chat.name||'Conversación sin nombre').slice(0,160)};
    },
  });
}
