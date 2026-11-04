import{createHash}from'node:crypto';import{NextResponse}from'next/server';import{z}from'zod';
import{supabaseAdmin}from'@/lib/automations/admin-client';
import{readQueueJson}from'@/lib/multichannel/bounded-json';
export const runtime='nodejs';
const base={line_key:z.string().regex(/^WA-[A-Za-z0-9_-]{1,60}$/),session_phone:z.string().regex(/^\d{7,15}$/)};
const ref={job_id:z.string().uuid(),claim_token:z.string().uuid()};
const schema=z.discriminatedUnion('action',[
 z.object({action:z.literal('heartbeat'),...base,ready:z.boolean()}).strict(),
 z.object({action:z.literal('claim'),...base}).strict(),
 z.object({action:z.literal('authorize'),...base,...ref,chat_id:z.string().regex(/^\d{7,15}@c\.us$/),body_hash:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),
 z.object({action:z.literal('release'),...base,...ref}).strict(),
 z.object({action:z.literal('ack'),...base,job_id:z.string().uuid(),state:z.literal('delivered'),provider_id:z.string().min(1).max(1024)}).strict(),
 z.object({action:z.literal('record'),...base,...ref,state:z.enum(['accepted','delivered','failed','needs_review']),provider_id:z.string().min(1).max(1024).optional()}).strict().refine(v=>!['accepted','delivered'].includes(v.state)||!!v.provider_id,'Falta el acuse del proveedor.'),
]);
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
export async function POST(request:Request){
 if(process.env.MULTICHANNEL_CAMPAIGNS_ENABLED!=='true')return reply({error:'Campañas reales todavía no habilitadas.'},503);
 const auth=request.headers.get('authorization')??'';if(!/^Bearer wcm_[a-f0-9]{64}$/.test(auth))return reply({error:'Ejecutor no autorizado.'},401);
 const decoded=await readQueueJson(request,16000);if(!decoded.ok)return reply({error:'Solicitud inválida o demasiado grande.'},decoded.status);
 const parsed=schema.safeParse(decoded.value);if(!parsed.success)return reply({error:'Acción inválida.'},400);
 const a=parsed.data,db=supabaseAdmin();
 const w=await db.from('multichannel_workers').select('id,account_id').eq('token_hash',createHash('sha256').update(auth.slice(7)).digest('hex')).eq('enabled',true).maybeSingle();
 if(w.error)return reply({error:'Ejecutor no disponible.'},503);if(!w.data)return reply({error:'Ejecutor revocado.'},401);
 const{data,error}=await db.rpc('multichannel_campaign_worker_step',{
  p_worker_id:w.data.id,p_line_key:a.line_key,p_action:a.action,p_job_id:'job_id'in a?a.job_id:null,
  p_claim_token:'claim_token'in a?a.claim_token:null,p_ready:a.action==='heartbeat'?a.ready:null,
  p_session_phone:a.session_phone,p_state:a.action==='record'||a.action==='ack'?a.state:null,p_provider_id:a.action==='record'||a.action==='ack'?a.provider_id??null:null,
 });
 if(error)return reply({error:'No se confirmó la transición de campaña.'},error.code==='42501'?403:503);
 if(a.action==='authorize'){
  if(!data?.allowed||data.job_id!==a.job_id||data.chat_id!==a.chat_id||createHash('sha256').update(data.body??'').digest('hex')!==a.body_hash)return reply({permit:{allowed:false}});
  return reply({permit:{allowed:true,permissionConfirmed:true,paused:false,accountId:data.account_id,lineKey:data.line_key,sessionPhone:data.session_phone,jobId:data.job_id,campaignId:data.campaign_id,chatId:data.chat_id,bodyHash:a.body_hash,expiresAt:Date.parse(data.expires_at)}});
 }
 return reply({[a.action==='claim'?'job':'receipt']:data});
}
