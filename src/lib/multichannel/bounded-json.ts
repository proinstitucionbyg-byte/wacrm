export async function readQueueJson(request:Request,maxBytes:number):Promise<{ok:true;value:unknown}|{ok:false;status:400|413}>{
 if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')??''))return{ok:false,status:400};
 const reader=request.body?.getReader();if(!reader)return{ok:false,status:400};
 const chunks:Uint8Array[]=[];let size=0;
 try{
  while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>maxBytes){await reader.cancel();return{ok:false,status:413};}chunks.push(part.value);}
  const combined=new Uint8Array(size);let offset=0;for(const chunk of chunks){combined.set(chunk,offset);offset+=chunk.byteLength;}
  return{ok:true,value:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(combined))};
 }catch{return{ok:false,status:400};}
}
