// whatsapp-web.js 1.34.7 spreads MediaData into an outgoing message. Recent
// WhatsApp builds expose __x_id there, replacing the newly generated ID.
// Preserve the prepared media without modifying the installed vendor package.
// https://github.com/wwebjs/whatsapp-web.js/issues/201921
export function installMediaModelCompatibility(){
 const api=window.WWebJS;
 if(typeof api?.processMediaData!=='function')throw Error('WhatsApp media preparation unavailable');
 if(api.processMediaData.wacrmMediaCompatible)return;
 const original=api.processMediaData;
 const compatible=async function(...args){
  const media=await original.apply(this,args);
  if(!media||typeof media!=='object')throw Error('WhatsApp returned no prepared media');
  const result={...media,...(typeof media.toJSON==='function'?media.toJSON():{})};
  delete result.__x_id;
  const token=args[0]?.wacrmReceiptToken;
  if(typeof token==='string'&&/^[0-9a-f-]{36}$/i.test(token)&&typeof result.filehash==='string'){
   const receipts=api.__wacrmPreparedMediaReceipts??=new Map();
   receipts.set(token,{filehash:result.filehash});
   while(receipts.size>16)receipts.delete(receipts.keys().next().value);
  }
  return result;
 };
 compatible.wacrmMediaCompatible=true;api.processMediaData=compatible;
}
