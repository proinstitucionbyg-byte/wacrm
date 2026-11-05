import {createHash} from 'node:crypto';

export function normalizeSessionMedia(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['kind','url','caption','filename'].includes(k))||!['audio','image','video','document'].includes(value.kind)||typeof value.url!=='string'||value.url.length>4096)throw Error('Archivo de WhatsApp inválido.');
 const url=new URL(value.url);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.port&&url.port!=='443')throw Error('El archivo requiere un enlace HTTPS sin credenciales.');
 if(value.caption!==undefined&&(typeof value.caption!=='string'||value.caption.length>4000)||value.filename!==undefined&&(typeof value.filename!=='string'||value.filename.length>200||/[\\/\r\n\0]/.test(value.filename)||['.','..'].includes(value.filename)))throw Error('Nombre o texto de archivo inválido.');
 return {kind:value.kind,url:url.href,...(value.caption?{caption:value.caption}:{}),...(value.filename?{filename:value.filename}:{})};
}

export function sessionPayloadHash(body,media){
 if(typeof body!=='string')throw Error('Mensaje inválido.');
 const m=media?normalizeSessionMedia(media):null;
 return createHash('sha256').update(m?JSON.stringify([body,m.kind,m.url,m.caption??'',m.filename??'']):body).digest('hex');
}

export function createSessionMediaLoader({allowedOrigins,makeMedia,fetchImpl=fetch,maxBytes=32*1024*1024,timeoutMs=30000}){
 if(!Array.isArray(allowedOrigins)||!allowedOrigins.length||typeof makeMedia!=='function'||!Number.isInteger(maxBytes)||maxBytes<1||maxBytes>64*1024*1024)throw Error('Falta configurar el origen autorizado de archivos.');
 const origins=new Set(allowedOrigins.map(origin=>{const u=new URL(origin);if(u.protocol!=='https:'||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw Error('Origen inválido.');return u.origin;}));
 return async value=>{
  const media=normalizeSessionMedia(value),url=new URL(media.url);
  if(!origins.has(url.origin)||!url.pathname.startsWith('/storage/v1/object/public/'))throw Error('Este archivo no pertenece al almacenamiento autorizado.');
  const response=await fetchImpl(url,{redirect:'error',signal:AbortSignal.timeout(timeoutMs)});
  if(!response.ok||!response.body)throw Error('No se pudo descargar el archivo.');
  const limit=Math.min(maxBytes,media.kind==='audio'?16*1024*1024:maxBytes);
  if(Number(response.headers.get('content-length')??0)>limit){await response.body.cancel();throw Error('El archivo supera el tamaño permitido.');}
  let mime=(response.headers.get('content-type')??'').split(';')[0].trim().toLowerCase();if(media.kind==='audio'&&mime==='application/ogg')mime='audio/ogg';
  const valid=media.kind==='audio'?/^audio\/(ogg|mpeg|mp4|aac|wav|webm|opus)$/.test(mime):media.kind==='image'?/^image\/(jpeg|png|webp|gif)$/.test(mime):media.kind==='video'?/^video\/(mp4|webm|3gpp)$/.test(mime):/^(application\/(pdf|octet-stream|msword|vnd\.[a-z0-9.+-]+)|text\/plain)$/.test(mime);
  if(!valid){await response.body.cancel();throw Error('El tipo real del archivo no corresponde al mensaje.');}
  const reader=response.body.getReader(),parts=[];let size=0;
  while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>limit){await reader.cancel();throw Error('El archivo supera el tamaño permitido.');}parts.push(chunk.value);}
  if(!size)throw Error('El archivo está vacío.');
  return {content:makeMedia(mime,Buffer.concat(parts).toString('base64'),media.filename),options:{sendSeen:false,...(media.caption&&media.kind!=='audio'?{caption:media.caption}:{}),...(media.kind==='audio'?{sendAudioAsVoice:true}:{})}};
 };
}
