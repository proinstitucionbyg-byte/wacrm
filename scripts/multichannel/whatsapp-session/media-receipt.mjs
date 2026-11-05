// Read-only proof for a provider send that returned no Message. Compare exact
// file hashes and the native resolved recipient, never captions or timing alone.
export async function snapshotMediaReceipts({chatId,filehash}){
 const chat=await window.WWebJS.getChat(chatId,{getAsModel:false});
 if(!chat||!/^\d+@(c\.us|lid|g\.us)$/.test(chat.id?.toString?.()??''))throw Error('Media recipient unavailable');
 const messages=chat.msgs?.getModelsArray?.();if(!Array.isArray(messages))throw Error('Media history unavailable');
 return {chatId:chat.id.toString(),ids:messages.filter(message=>message.id?.fromMe===true&&message.filehash===filehash
   &&message.to?.toString?.()===chat.id.toString()).map(message=>message.id._serialized??message.id.toString()).filter(id=>typeof id==='string'&&id.startsWith('true_'))};
}
