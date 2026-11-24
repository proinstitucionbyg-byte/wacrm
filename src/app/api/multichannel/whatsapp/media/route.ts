import {after} from 'next/server';
import {processSessionImage} from '@/lib/whatsapp/session-image-analysis';
import { createHash } from 'node:crypto';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { SESSION_MEDIA_BUCKET, SESSION_MEDIA_LIMIT, receivedMime, receivedMediaKind } from '@/lib/whatsapp/session-received-media';
export const runtime = 'nodejs';
const reply = (error: string, status: number) => Response.json({ error }, { status, headers:{'Cache-Control':'no-store'} });
async function source(request: Request) {
  if(process.env.MULTICHANNEL_WHATSAPP_SESSION_BRIDGE_ENABLED!=='true')return {response:reply('Puente no habilitado.',503)};
  const authorization=request.headers.get('authorization')||'';
  if(!/^Bearer wcm_[a-f0-9]{64}$/.test(authorization))return {response:reply('Ejecutor no autorizado.',401)};
  const line=request.headers.get('x-wa-line')||'', phone=request.headers.get('x-wa-phone')||'';
  let provider='';try{provider=decodeURIComponent(request.headers.get('x-wa-provider')||'');}catch{return {response:reply('Mensaje inválido.',400)};}
  if(!/^WA-[A-Za-z0-9_-]{1,60}$/.test(line)||!/^\d{7,15}$/.test(phone)||!provider||provider.length>1024)return {response:reply('Origen inválido.',400)};
  const db=supabaseAdmin();const worker=await db.from('multichannel_workers').select('id,account_id').eq('token_hash',createHash('sha256').update(authorization.slice(7)).digest('hex')).eq('enabled',true).maybeSingle();
  if(worker.error)throw worker.error;if(!worker.data)return {response:reply('Ejecutor no autorizado.',401)};
  const binding=await db.from('multichannel_whatsapp_session_lines').select('line_key').eq('account_id',worker.data.account_id).eq('worker_id',worker.data.id).eq('line_key',line).eq('linked_phone',phone).maybeSingle();
  if(binding.error)throw binding.error;if(!binding.data)return {response:reply('La línea ya no corresponde a este teléfono.',403)};
  const own=request.headers.get('x-wa-own')==='true';
  const message=await db.from('messages').select('id,media_url,content_type,conversation_id,conversations!inner(account_id)').eq('conversations.account_id',worker.data.account_id).eq('whatsapp_session_line_key',line).eq('message_id',own?provider:`waweb:${line}:${provider}`).in('sender_type',own?['agent','bot']:['customer']).maybeSingle();
  if(message.error)throw message.error;if(!message.data)return {response:reply('El mensaje todavía no está sincronizado.',404)};
  return {db,account:worker.data.account_id,message:message.data};
}
export async function HEAD(request: Request) {
  try { const result=await source(request);if(result.response)return result.response;return new Response(null,{status:result.message!.media_url?204:404,headers:{'Cache-Control':'no-store'}}); }
  catch{return reply('No se pudo comprobar el archivo.',503);}
}
export async function POST(request: Request) {
  try {
    const result=await source(request);if(result.response)return result.response;
    const {db,account,message}=result;
    const analyze=()=>{if(message!.content_type==='image'&&request.headers.get('x-wa-own')!=='true')after(async()=>{try{await processSessionImage(db!,account!,message!.id);}catch(error){console.error('[session image] review pending',error);}});};
    if(message!.media_url){analyze();return Response.json({stored:true,reused:true});}
    const mime=receivedMime(request.headers.get('content-type')||'');
    if(receivedMediaKind(mime)!==message!.content_type)return reply('El formato no coincide con el mensaje.',415);
    if(Number(request.headers.get('content-length')||0)>SESSION_MEDIA_LIMIT)return reply('El archivo supera 16 MB.',413);
    const reader=request.body?.getReader();if(!reader)return reply('Falta el archivo.',400);
    const chunks:Uint8Array[]=[];let size=0;
    while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>SESSION_MEDIA_LIMIT){await reader.cancel();return reply('El archivo supera 16 MB.',413);}chunks.push(part.value);}
    if(!size)return reply('El archivo está vacío.',400);
    const path=`${account}/${message!.id}`;
    const upload=await db!.storage.from(SESSION_MEDIA_BUCKET).upload(path,Buffer.concat(chunks),{contentType:mime,upsert:false});
    if(upload.error&&!['409','Duplicate','23505'].includes(String((upload.error as {statusCode?:string}).statusCode||upload.error.name)))throw upload.error;
    const saved=await db!.from('messages').update({media_url:`/api/whatsapp/session-media/${message!.id}`}).eq('id',message!.id).eq('conversation_id',message!.conversation_id).is('media_url',null).select('id');
    if(saved.error)throw saved.error;
    analyze();
    return Response.json({stored:true},{headers:{'Cache-Control':'no-store'}});
  }catch{return reply('El archivo sigue pendiente de sincronizar.',503);}
}
