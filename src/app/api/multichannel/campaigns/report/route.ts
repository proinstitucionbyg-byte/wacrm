import{NextResponse}from'next/server';
import{requireRole,toErrorResponse}from'@/lib/auth/account';
import{supabaseAdmin}from'@/lib/automations/admin-client';
import{campaignReport,type ReportJob}from'@/lib/multichannel/campaign-report';
import{z}from'zod';
export const runtime='nodejs';
export async function GET(request:Request){
 let ctx;try{ctx=await requireRole('owner');}catch(e){return toErrorResponse(e);}
 const id=new URL(request.url).searchParams.get('campaign_id');if(!z.string().uuid().safeParse(id).success)return NextResponse.json({error:'Campaña inválida.'},{status:400});
 const db=supabaseAdmin(),campaign=await db.from('multichannel_campaigns').select('id,name,status,recipient_variables').eq('account_id',ctx.accountId).eq('id',id!).maybeSingle();
 if(campaign.error)return NextResponse.json({error:'No se pudo consultar la campaña.'},{status:503});
 if(!campaign.data)return NextResponse.json({error:'Campaña no encontrada.'},{status:404});
 const jobs:ReportJob[]=[];
 for(let offset=0;offset<=21000;offset+=1000){
  const result=await db.from('multichannel_jobs').select('id,contact_id,recipient,mode,status,campaign_sequence,campaign_step,started_at,provider_id,routing_alert').eq('account_id',ctx.accountId).eq('campaign_id',id!).order('campaign_sequence').order('id').range(offset,offset+999);
  if(result.error)return NextResponse.json({error:'No se pudo completar el informe. No se muestran cifras parciales.'},{status:503});
  jobs.push(...result.data);if(result.data.length<1000)break;
  if(offset===21000)return NextResponse.json({error:'La campaña supera el tamaño de informe permitido.'},{status:503});
 }
 const report=campaignReport(jobs,campaign.data.recipient_variables??{});
 return NextResponse.json({campaign:{id:campaign.data.id,name:campaign.data.name,status:campaign.data.status},report,checkedAt:new Date().toISOString(),canExport:campaign.data.status!=='active'&&!report.counts.processing},{headers:{'Cache-Control':'no-store'}});
}
