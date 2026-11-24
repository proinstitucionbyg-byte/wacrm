import{createHash}from'node:crypto';
import{NextResponse}from'next/server';
import{requireRole,toErrorResponse}from'@/lib/auth/account';
import{supabaseAdmin}from'@/lib/automations/admin-client';
import{liveCampaignActionSchema,liveCampaignSchedule,normalizeCampaignPhone,assertCampaignMediaOwnership,campaignSequenceSchema}from'@/lib/multichannel/live-campaign';
import{z}from'zod';
import{readQueueJson}from'@/lib/multichannel/bounded-json';
import{resolveCampaignAudience,importCampaignContacts}from'@/lib/multichannel/campaign-audience';
import{visibleSessionLines}from'@/lib/multichannel/session-line-visibility';
export const runtime='nodejs';
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
export async function GET(request:Request){
 let ctx;try{ctx=await requireRole('owner');}catch(e){return toErrorResponse(e);}
 if(process.env.MULTICHANNEL_CAMPAIGNS_ENABLED!=='true')return reply({error:'Campañas reales todavía no habilitadas.'},503);
 const db=supabaseAdmin();
 const selected=new URL(request.url).searchParams.get('campaign_id');
 if(selected){
  if(!z.string().uuid().safeParse(selected).success)return reply({error:'Campaña inválida.'},400);
  const[campaign,jobs]=await Promise.all([
   db.from('multichannel_campaigns').select('id,name,body,sequence,sms_body,status,routes,dispatch_mode,distribution,run_at,expires_at,review_hash,created_at').eq('account_id',ctx.accountId).eq('id',selected).maybeSingle(),
   db.from('multichannel_jobs').select('id,campaign_id,recipient,status,run_at,routing_alert,line_key').eq('account_id',ctx.accountId).eq('campaign_id',selected).eq('mode','whatsapp_live').eq('campaign_step',0).order('campaign_sequence').limit(1000),
  ]);
  if(campaign.error||jobs.error)return reply({error:'No se pudo recuperar la revisión completa.'},503);
  if(!campaign.data)return reply({error:'Campaña no encontrada.'},404);
  return reply({campaign:campaign.data,jobs:jobs.data});
 }
 const [campaigns,jobs,lines,sms,states]=await Promise.all([
  db.from('multichannel_campaigns').select('id,name,body,sequence,sms_body,status,routes,dispatch_mode,distribution,run_at,expires_at,review_hash,created_at').eq('account_id',ctx.accountId).order('created_at',{ascending:false}).limit(100),
  db.from('multichannel_jobs').select('id,campaign_id,contact_id,recipient,channel,line_key,status,run_at,expires_at,routing_alert,provider_state').eq('account_id',ctx.accountId).not('campaign_id','is',null).order('run_at',{ascending:false}).limit(500),
  db.from('multichannel_whatsapp_session_lines').select('line_key,linked_phone,worker_id,paused,campaign_ready_at').eq('account_id',ctx.accountId),
  db.from('multichannel_lines').select('line_key,paused,available').eq('account_id',ctx.accountId).like('line_key','SMS-%'),
  db.from('whatsapp_management_state').select('worker_id,snapshot').eq('account_id',ctx.accountId),
 ]);
 if(campaigns.error||jobs.error||lines.error||sms.error||states.error)return reply({error:'No se pudo consultar el estado de campañas.'},503);
 return reply({campaigns:campaigns.data,jobs:jobs.data,lines:visibleSessionLines(lines.data??[],states.data??[]),smsLines:sms.data,limit:500});
}
export async function POST(request:Request){
 let ctx;try{ctx=await requireRole('owner');}catch(e){return toErrorResponse(e);}
 if(process.env.MULTICHANNEL_CAMPAIGNS_ENABLED!=='true')return reply({error:'Campañas reales todavía no habilitadas.'},503);
 const decoded=await readQueueJson(request,1_500_000);if(!decoded.ok)return reply({error:'Solicitud inválida o demasiado grande.'},decoded.status);
 const json=decoded.value;
 const imported=z.object({action:z.literal('import_recipients'),recipients:z.array(z.object({phone:z.string().max(40),name:z.string().trim().max(200).optional()}).strict()).min(1).max(1000)}).strict().safeParse(json);
 if(imported.success){
  try{return reply(await importCampaignContacts(supabaseAdmin(),ctx.accountId,ctx.userId,imported.data.recipients));}
  catch(e){return reply({error:e instanceof Error?e.message:'No se pudo registrar la lista.'},400);}
 }
 const audience=z.object({action:z.literal('resolve_recipients'),phones:z.array(z.string().max(40)).min(1).max(1000)}).strict().safeParse(json);
 if(audience.success){
  const phones=[...new Set(audience.data.phones.map(normalizeCampaignPhone))];if(phones.includes(null))return reply({error:'Revisa los teléfonos. Usa nueve dígitos para Perú o el prefijo internacional.'},400);
  try{return reply({recipients:await resolveCampaignAudience(supabaseAdmin(),ctx.accountId,phones as string[])});}
  catch{return reply({error:'No se pudo resolver la lista de contactos.'},503);}
 }
 const edit=z.object({action:z.literal('edit_content'),campaign_id:z.string().uuid(),expected_review_hash:z.string().regex(/^[a-f0-9]{64}$/),name:z.string().trim().min(1).max(100),sequence:campaignSequenceSchema}).strict().safeParse(json);
 if(edit.success){
  try{assertCampaignMediaOwnership(edit.data,ctx.accountId,process.env.NEXT_PUBLIC_SUPABASE_URL??'');}catch{return reply({error:'Selecciona archivos del almacenamiento de esta cuenta.'},400);}
  const value=edit.data;const hash=createHash('sha256').update(JSON.stringify({name:value.name,sequence:value.sequence})).digest('hex');
  const{data,error}=await supabaseAdmin().rpc('edit_pending_campaign_content',{p_account:ctx.accountId,p_actor:ctx.userId,p_campaign:value.campaign_id,p_expected_hash:value.expected_review_hash,p_name:value.name,p_sequence:value.sequence,p_new_hash:hash});
  if(error)return reply({error:error.code==='40001'?'Otra persona cambió la campaña. Actualiza antes de editar.':error.code==='22023'?'Pausa la campaña y conserva la cantidad de pasos y sus tiempos. Revisa que no haya vencido.':'No se confirmó el cambio de contenido.'},error.code==='40001'?409:error.code==='22023'?400:503);
  return reply({campaign:data});
 }
 const input=liveCampaignActionSchema.safeParse(json);if(!input.success)return reply({error:'Revisa fechas, líneas, permisos y destinatarios.'},400);
 let payload:Record<string,unknown>;
 if(input.data.action==='create'){
  try{const{plan}=liveCampaignSchedule(input.data.campaign);assertCampaignMediaOwnership(plan,ctx.accountId,process.env.NEXT_PUBLIC_SUPABASE_URL??'');payload={...plan,review_hash:createHash('sha256').update(JSON.stringify(plan)).digest('hex')};}
  catch{return reply({error:'La campaña venció o su programación no es válida.'},400);}
 }else{const{action,...rest}=input.data;void action;payload=rest;}
 const{data,error}=await supabaseAdmin().rpc('multichannel_campaign_control',{p_account_id:ctx.accountId,p_actor_id:ctx.userId,p_action:input.data.action,p_payload:payload});
 if(error)return reply({error:error.code==='23505'?'Hay una solicitud o teléfonos repetidos. Consulta el estado y revisa la lista.':error.code==='42501'?'Algún contacto o línea no pertenece a tu cuenta.':'No se confirmó el cambio. Consulta su estado antes de repetir.'},error.code==='23505'?409:error.code==='42501'?403:503);
 if(!data)return reply({error:'Campaña no encontrada.'},404);
 return reply({campaign:data},input.data.action==='create'?201:200);
}
