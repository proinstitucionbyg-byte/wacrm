import {NextResponse} from 'next/server';
import {supabaseAdmin} from '@/lib/automations/admin-client';
import {drainSupportWaits} from '@/lib/whatsapp/cloud-support-wait';
export async function GET(request:Request){
 const secret=process.env.AUTOMATION_CRON_SECRET;
 if(!secret)return NextResponse.json({error:'cron not configured'},{status:503});
 if(request.headers.get('x-cron-secret')!==secret)return NextResponse.json({error:'Unauthorized'},{status:401});
 try{return NextResponse.json({processed:await drainSupportWaits(supabaseAdmin())},{headers:{'Cache-Control':'no-store'}});}
 catch{return NextResponse.json({error:'No se pudo comprobar la espera de Meta.'},{status:503});}
}
