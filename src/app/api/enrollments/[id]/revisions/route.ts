import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { UUID_PATTERN } from '@/lib/team-chat';
import { readQueueJson } from '@/lib/multichannel/bounded-json';
import { planRegisteredCorrection } from '@/lib/matriculas/registered-correction';
import { enrollmentIssues } from '@/lib/matriculas/enrollment';

const reply = (body: unknown, status=200) => NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
type Context = {params: Promise<{id:string}>};
export async function GET(_request: Request,{params}:Context){
 try{
  const ctx=await requirePermission('enrollments','view'),{id}=await params;
  if(process.env.NEXT_PUBLIC_ENROLLMENT_CORRECTIONS_ENABLED!=='true')return reply({error:'La corrección de matrículas está aplazada.'},503);
  if(!UUID_PATTERN.test(id))return reply({error:'Matrícula inválida.'},400);
  const {data,error}=await ctx.supabase.from('enrollment_correction_requests')
   .select('id,scope,reason,status,patch,impact,result,created_at,updated_at')
   .eq('account_id',ctx.accountId).eq('enrollment_id',id).order('created_at',{ascending:false}).limit(20);
  if(error)throw error;
  return reply({requests:data??[]});
 }catch(error){return toErrorResponse(error);}
}
export async function POST(request:Request,{params}:Context){
 try{
  const ctx=await requirePermission('enrollments','edit'),{id}=await params;
  if(process.env.NEXT_PUBLIC_ENROLLMENT_CORRECTIONS_ENABLED!=='true')return reply({error:'La corrección de matrículas está aplazada.'},503);
  if(!UUID_PATTERN.test(id))return reply({error:'Matrícula inválida.'},400);
  const decoded=await readQueueJson(request,16000);
  if(!decoded.ok)return reply({error:'Solicitud inválida.'},decoded.status);
  const body=decoded.value as Record<string,unknown> | null;
  if(!body||!['preview','request'].includes(String(body.action))||!['crm','linked'].includes(String(body.scope))
   || !Number.isSafeInteger(body.version)||Number(body.version)<1)return reply({error:'Revisa la solicitud de corrección.'},400);
  const {data:draft,error}=await ctx.supabase.from('enrollment_drafts').select('id,status,version,data')
   .eq('account_id',ctx.accountId).eq('id',id).maybeSingle();
  if(error)throw error;
  if(!draft)return reply({error:'Matrícula no encontrada.'},404);
  if(draft.status!=='registered'||draft.version!==body.version)return reply({error:'La ficha cambió. Vuelve a abrirla y revisa los datos antes de corregir.'},409);
  let plan;
  try{plan=planRegisteredCorrection(draft.data,body.patch,body.scope as 'crm'|'linked');}
  catch(error){return reply({error:error instanceof Error?error.message:'Corrección inválida.'},400);}
  const patch=Object.fromEntries(plan.changes.map(change=>[change.field,change.after]));
  const issues=enrollmentIssues({...draft.data,...patch}).filter(issue=>issue.startsWith('REVISAR '));
  if(issues.length)return reply({error:issues.join('. ')},400);
  if(body.action==='preview')return reply({plan,applied:false});
  if(typeof body.request_id!=='string'||!UUID_PATTERN.test(body.request_id)||typeof body.reason!=='string'
   ||body.reason.trim().length<10||body.reason.trim().length>1000||body.confirmed!==true)
   return reply({error:'Escribe el motivo y confirma que revisaste el alcance de la corrección.'},400);
  const {data:saved,error:saveError}=await supabaseAdmin().rpc('request_registered_student_correction',{
   p_id:body.request_id,p_account_id:ctx.accountId,p_enrollment_id:id,p_expected_version:draft.version,
   p_scope:body.scope,p_reason:body.reason.trim(),p_patch:patch,p_impact:plan,p_actor:ctx.userId,
  });
  if(saveError){
   if(['23505','40001'].includes(saveError.code))return reply({error:'Hay otra corrección o la ficha cambió. Actualiza antes de continuar.'},409);
   throw saveError;
  }
  return reply({request:saved,applied:false,message:'Solicitud guardada. Los datos y documentos todavía no se han modificado.'},202);
 }catch(error){return toErrorResponse(error);}
}
