// Runs inside the isolated WhatsApp page. Preserve vendor serialization and
// restore only provider identifiers from the raw key's own representation.
export function installMessageModelCompatibility() {
  const api=window.WWebJS;
  if(typeof api?.getMessageModel!=='function')throw Error('WhatsApp message model unavailable');
  if(api.getMessageModel.wacrmKeyCompatible)return;
  const original=api.getMessageModel;
  const address=value=>{
    const text=typeof value==='string'?value:value?._serialized??value?.toString?.();
    return typeof text==='string'&&/^\d+@(c\.us|lid|g\.us)$/.test(text)?text:null;
  };
  const compatible=function(message){
    const result=original.call(this,message);
    const key=message?.id?._serialized??message?.id?.toString?.();
    if(result&&typeof key==='string'&&key.length<=1024&&/^(true|false)_/.test(key)){
      result.id={...result.id,_serialized:key};
    }
    for(const field of ['from','to']){
      const value=address(message?.[field]);
      if(result&&value)result[field]=value;
    }
    return result;
  };
  compatible.wacrmKeyCompatible=true;
  api.getMessageModel=compatible;
}
