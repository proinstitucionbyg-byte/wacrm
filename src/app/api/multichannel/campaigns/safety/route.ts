import{NextResponse}from'next/server';
import{supabaseAdmin}from'@/lib/automations/admin-client';
export async function GET(request:Request){
 const secret=process.env.AUTOMATION_CRON_SECRET;
 if(!secret||request.headers.get('x-cron-secret')!==secret)return NextResponse.json({error:'Unauthorized'},{status:401});
 const r=await supabaseAdmin().rpc('campaign_safety_sweep');
 return NextResponse.json(r.error?{error:'No se completó la revisión de campañas.'}:r.data,{status:r.error?503:200,headers:{'Cache-Control':'no-store'}});
}
