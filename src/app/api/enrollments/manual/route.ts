import {randomUUID} from 'node:crypto';
import {NextResponse} from 'next/server';
import {requirePermission} from '@/lib/auth/permissions';
import {toErrorResponse} from '@/lib/auth/account';
import {supabaseAdmin} from '@/lib/flows/admin-client';
import {analyzeInboundImage} from '@/lib/ai/analyze-image';
import {parseEnrollmentData,suggestIdentityData} from '@/lib/matriculas/enrollment';
import {collectPaymentData} from '@/lib/matriculas/collect-data';
import {loadAcademicCalendar} from '@/lib/matriculas/calendar';

export async function GET(){try{
  const ctx=await requirePermission('enrollments','edit');
  const [chats,sales,calendar]=await Promise.all([
    ctx.supabase.from('conversations').select('id,contact:contacts(name,phone)').eq('account_id',ctx.accountId).order('last_message_at',{ascending:false}).limit(100),
    ctx.supabase.from('profiles').select('user_id,full_name,nickname,area,account_role').eq('account_id',ctx.accountId),
    loadAcademicCalendar(ctx.supabase,ctx.accountId),
  ]);
  if(chats.error)throw chats.error;if(sales.error)throw sales.error;
  return NextResponse.json({chats:chats.data,sales:(sales.data??[]).filter(p=>p.area?.toUpperCase()==='VENTAS'||p.account_role==='owner'),calendar});
}catch(error){return toErrorResponse(error);}}

export async function POST(request:Request){
  const uploaded:string[]=[];let db:ReturnType<typeof supabaseAdmin>|undefined;let rpcStarted=false;
  try{
    const ctx=await requirePermission('enrollments','edit');
    const form=await request.formData();
    let data;try{data=parseEnrollmentData(JSON.parse(String(form.get('data')||'{}')));}catch{return NextResponse.json({error:'Datos invalidos'},{status:400});}
    if(!data)return NextResponse.json({error:'Datos invalidos'},{status:400});
    const conversation=String(form.get('conversation_id')||''),salesAgent=String(form.get('sales_agent_id')||'');
    const requestKey=String(form.get('request_key')||'');
    if(!/^[0-9a-f-]{36}$/i.test(requestKey))return NextResponse.json({error:'Vuelve a abrir el ingreso para identificar este envio.'},{status:400});
    if(!/^[0-9a-f-]{36}$/i.test(conversation)||!/^[0-9a-f-]{36}$/i.test(salesAgent))return NextResponse.json({error:'Selecciona el chat y la asesora de ventas.'},{status:400});
    const {data:visible,error:visibleError}=await ctx.supabase.from('conversations').select('id').eq('id',conversation).eq('account_id',ctx.accountId).maybeSingle();
    if(visibleError)throw visibleError;if(!visible)return NextResponse.json({error:'No tienes acceso al chat.'},{status:403});
    const files=['front','back','voucher','declaration','guardian'].map(kind=>({kind,file:form.get(kind)})).filter((x):x is {kind:string;file:File}=>x.file instanceof File&&x.file.size>0);
    if(!files.some(x=>x.kind==='voucher')||!files.some(x=>['front','declaration'].includes(x.kind)))return NextResponse.json({error:'Sube el voucher y el DNI/CE o el pantallazo de los datos del estudiante.'},{status:400});
    if(files.some(x=>x.file.size>10*1024*1024||!['image/jpeg','image/png','image/webp'].includes(x.file.type)))return NextResponse.json({error:'Solo imagenes JPG, PNG o WEBP de hasta 10 MB.'},{status:400});
    db=supabaseAdmin();const batch=randomUUID(),evidence=[];
    for(const {kind,file} of files){
      const id=randomUUID(),path=`${ctx.accountId}/manual/${batch}/${id}`;
      const buffer=Buffer.from(await file.arrayBuffer());
      const {error}=await db.storage.from('enrollment-evidence').upload(path,buffer,{contentType:file.type,upsert:false});if(error)throw error;uploaded.push(path);
      const {analysis}=await analyzeInboundImage({db,accountId:ctx.accountId,media:{buffer,contentType:file.type}});
      evidence.push({id,kind,storage_path:path,mime_type:file.type,image_analysis:analysis});
      if(kind==='front'||kind==='back')data=suggestIdentityData(data,analysis);
      if(kind==='voucher')data=collectPaymentData(data,analysis.fields);
    }
    data.identity_confirmed=false;
    data.identity_message_ids=evidence.filter(x=>['front','back'].includes(x.kind)).map(x=>x.id);
    data.declaration_message_ids=evidence.filter(x=>x.kind==='declaration').map(x=>x.id);
    data.guardian_message_ids=evidence.filter(x=>x.kind==='guardian').map(x=>x.id);
    rpcStarted=true;
    const {data:result,error}=await db.rpc('create_manual_enrollment',{p_account:ctx.accountId,p_actor:ctx.userId,p_conversation:conversation,p_sales_agent:salesAgent,p_data:data,p_uploads:evidence,p_request_key:requestKey});
    if(error)throw error;
    if(result?.reused)await db.storage.from('enrollment-evidence').remove(uploaded);
    return NextResponse.json(result,{status:201});
  }catch(error){if(db&&uploaded.length&&!rpcStarted)await db.storage.from('enrollment-evidence').remove(uploaded);return toErrorResponse(error);}
}
