import {createHash} from 'node:crypto';
import {NextResponse} from 'next/server';
import {supabaseAdmin} from '@/lib/automations/admin-client';
import {managementHeartbeat} from '@/lib/multichannel/whatsapp-management';

const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
export async function POST(request:Request){
 if(process.env.MULTICHANNEL_WHATSAPP_SESSION_BRIDGE_ENABLED!=='true')return reply({error:'Puente no habilitado.'},503);
 const authorization=request.headers.get('authorization')??'';
 if(!/^Bearer wcm_[a-f0-9]{64}$/.test(authorization))return reply({error:'Ejecutor no autorizado.'},401);
 if(!/^application\/json(?:;|$)/i.test(request.headers.get('content-type')??''))return reply({error:'Solicitud inválida.'},400);
 try{
  const reader=request.body?.getReader();if(!reader)return reply({error:'Solicitud inválida.'},400);
  const chunks:Uint8Array[]=[];let size=0;
  while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>2100000){await reader.cancel();return reply({error:'Solicitud demasiado grande.'},413);}chunks.push(part.value);}
  const input=managementHeartbeat.safeParse(JSON.parse(Buffer.concat(chunks).toString('utf8')));if(!input.success)return reply({error:'Estado inválido.'},400);
  const db=supabaseAdmin();
  const worker=await db.from('multichannel_workers').select('id,account_id').eq('token_hash',createHash('sha256').update(authorization.slice(7)).digest('hex')).eq('enabled',true).maybeSingle();
  if(worker.error)throw worker.error;if(!worker.data)return reply({error:'Ejecutor no autorizado.'},401);
  const {id,account_id}=worker.data;
  let acknowledged:string|null=null;
  if(input.data.completed){
   const done=input.data.completed;
   const saved=await db.from('whatsapp_management_commands').update({status:done.status,result:done.result,finished_at:new Date().toISOString(),lease_until:null}).eq('id',done.id).eq('worker_id',id).eq('account_id',account_id).eq('status','running').select('id').maybeSingle();
   if(saved.error)throw saved.error;
   if(saved.data)acknowledged=done.id;
   else{const previous=await db.from('whatsapp_management_commands').select('status').eq('id',done.id).eq('worker_id',id).eq('account_id',account_id).maybeSingle();if(previous.error)throw previous.error;if(previous.data&&['done','error','needs_review'].includes(previous.data.status))acknowledged=done.id;}
   if(!acknowledged)return reply({error:'Resultado no confirmado; no repitas la acción.'},409);
  }
  const lines=input.data.lines.map(line=>({...line,archived:line.archived===true||line.label.startsWith('Historial '),qr:line.status==='awaiting_qr'&&!line.archived&&!line.label.startsWith('Historial ')?line.qr:null}));
  const saved=await db.from('whatsapp_management_state').upsert({worker_id:id,account_id,snapshot:lines,seen_at:new Date().toISOString()},{onConflict:'worker_id'});if(saved.error)throw saved.error;
  // A verified ready session is registered in pause. Only the owner enables its bot.
  const known=await db.from('multichannel_whatsapp_session_lines').select('line_key,linked_phone,worker_id').eq('account_id',account_id);if(known.error)throw known.error;
  for(const line of lines.filter(l=>!l.archived&&l.active&&l.status==='ready'&&l.linkedPhone)){
   if(!known.data?.some(l=>l.line_key===line.lineKey||l.linked_phone===line.linkedPhone)){
    const registered=await db.from('multichannel_whatsapp_session_lines').insert({account_id,worker_id:id,line_key:line.lineKey,linked_phone:line.linkedPhone,paused:true});
    if(registered.error&&registered.error.code!=='23505')throw registered.error;
   }
  }
  const command=await db.rpc('claim_whatsapp_management_command',{p_worker_id:id});if(command.error)throw command.error;
  return reply({accountId:account_id,acknowledged,command:command.data});
 }catch{return reply({error:'No se confirmó la gestión de WhatsApp.'},503);}
}
