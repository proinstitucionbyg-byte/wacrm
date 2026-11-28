import{NextResponse}from'next/server';
import{z}from'zod';
import{requireRole,toErrorResponse}from'@/lib/auth/account';
import{supabaseAdmin}from'@/lib/automations/admin-client';
import{readQueueJson}from'@/lib/multichannel/bounded-json';
import{canEnableSessionLine,visibleSessionLines}from'@/lib/multichannel/session-line-visibility';
import{safeDispatchJobs,type DispatchJob}from'@/lib/multichannel/manual-dispatch';
export const runtime='nodejs';
const reply=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:{'Cache-Control':'no-store'}});
export async function GET(request:Request){
 let ctx;try{ctx=await requireRole('owner');}catch(e){return toErrorResponse(e);}
 const id=new URL(request.url).searchParams.get('campaign_id');if(!z.string().uuid().safeParse(id).success)return reply({error:'Campaña inválida.'},400);
 const db=supabaseAdmin();
 const[campaign,lines,states]=await Promise.all([
  db.from('multichannel_campaigns').select('id,name,status,routes,interval_seconds,block_size,block_pause_seconds,expires_at,body,sequence,manual_batch_job_ids').eq('account_id',ctx.accountId).eq('id',id!).maybeSingle(),
  db.from('multichannel_whatsapp_session_lines').select('line_key,worker_id,linked_phone,paused,campaign_restricted').eq('account_id',ctx.accountId),
  db.from('whatsapp_management_state').select('worker_id,snapshot,seen_at').eq('account_id',ctx.accountId),
 ]);
 if(campaign.error||lines.error||states.error)return reply({error:'No se pudo consultar el envío completo.'},503);
 if(!campaign.data)return reply({error:'Campaña no encontrada.'},404);
 const jobs:DispatchJob[]=[];
 for(let offset=0;offset<=21000;offset+=1000){
  const r=await db.from('multichannel_jobs').select('id,contact_id,recipient,status,started_at,provider_id,predecessor_id,campaign_sequence,campaign_step,line_key').eq('account_id',ctx.accountId).eq('campaign_id',id!).eq('mode','whatsapp_live').order('campaign_sequence').order('campaign_step').order('id').range(offset,offset+999);
  if(r.error)return reply({error:'No se pudo completar el resumen.'},503);jobs.push(...r.data);if(r.data.length<1000)break;
  if(offset===21000)return reply({error:'La campaña supera el tamaño permitido.'},400);
 }
 const known=new Set(jobs.map(j=>j.id)),externalIds=[...new Set(jobs.map(j=>j.predecessor_id).filter((v):v is string=>!!v&&!known.has(v)))],external:DispatchJob[]=[];
 for(let offset=0;offset<externalIds.length;offset+=100){
  const r=await db.from('multichannel_jobs').select('id,contact_id,recipient,status,started_at,provider_id,predecessor_id,campaign_sequence,campaign_step,line_key').eq('account_id',ctx.accountId).in('id',externalIds.slice(offset,offset+100)).in('status',['accepted','delivered']);
  if(r.error)return reply({error:'No se pudieron comprobar los pasos anteriores.'},503);external.push(...r.data);
 }
 const safe=safeDispatchJobs([...jobs,...external]),safeIds=new Set(safe.map(j=>j.id)),counts:Record<string,number>={},lineCounts:Record<string,Record<string,number>>={};
 for(const j of jobs){counts[j.status]=(counts[j.status]??0)+1;const bucket=lineCounts[j.line_key]??={};bucket[j.status]=(bucket[j.status]??0)+1;}
 const available=visibleSessionLines(lines.data,states.data).map(l=>{
  const state=states.data.find(s=>s.worker_id===l.worker_id)??null,ready=canEnableSessionLine(l,state);
  return{...l,ready,counts:lineCounts[l.line_key]??{},status:l.campaign_restricted?'Restricción de WhatsApp':!ready?'Sin conexión confirmada':l.paused?'Conectada · bot pausado':'Disponible'};
 });
 return reply({campaign:campaign.data,counts,lines:available,pending:safe.map(j=>({...j,predecessor_id:j.predecessor_id&&safeIds.has(j.predecessor_id)?j.predecessor_id:null})),processing:(counts.claimed??0)+(counts.dispatching??0),checkedAt:new Date().toISOString()});
}
const schema=z.object({campaign_id:z.string().uuid(),request_id:z.string().uuid(),action:z.enum(['save','send']),lines:z.array(z.string().regex(/^WA-[A-Za-z0-9_-]{1,60}$/)).min(1).max(10),count:z.number().int().min(1).max(1000),unit:z.enum(['messages','recipients']),interval:z.number().int().min(1).max(86400),block:z.number().int().min(1).max(1000),pause:z.number().int().min(0).max(604800),enable_lines:z.boolean()}).strict();
export async function POST(request:Request){
 let ctx;try{ctx=await requireRole('owner');}catch(e){return toErrorResponse(e);}
 if(process.env.MULTICHANNEL_CAMPAIGNS_ENABLED!=='true')return reply({error:'Envíos reales no habilitados.'},503);
 const decoded=await readQueueJson(request,20000);if(!decoded.ok)return reply({error:'Solicitud inválida.'},400);
 const parsed=schema.safeParse(decoded.value);if(!parsed.success)return reply({error:'Revisa cantidad, líneas y tiempos.'},400);
 const v=parsed.data;
 const result=await supabaseAdmin().rpc('adjust_campaign_dispatch',{p_account:ctx.accountId,p_actor:ctx.userId,p_campaign:v.campaign_id,p_request:v.request_id,p_action:v.action,p_lines:v.lines,p_count:v.count,p_unit:v.unit,p_interval:v.interval,p_block:v.block,p_pause:v.pause,p_enable:v.enable_lines});
 if(result.error)return reply({error:result.error.message},409);
 return reply(result.data);
}
