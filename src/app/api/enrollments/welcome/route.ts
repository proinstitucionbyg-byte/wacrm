import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { toErrorResponse } from '@/lib/auth/account';
import { UUID_PATTERN } from '@/lib/team-chat';
export async function GET(request:Request){
  try {
    const ctx=await requirePermission('inbox','view');
    const conversation=new URL(request.url).searchParams.get('conversation');
    if(!UUID_PATTERN.test(conversation??''))return NextResponse.json({error:'Chat invalido'},{status:400});
    const {data,error}=await ctx.supabase.from('enrollment_sequence_runs').select('id,welcome_due_at,completed_at,completed_by,backup_sent_at,status').eq('account_id',ctx.accountId).eq('conversation_id',conversation).eq('stage','final').order('started_at',{ascending:false}).limit(10);
    if(error)throw error;
    return NextResponse.json({tasks:data??[]});
  }catch(error){return toErrorResponse(error);}
}
export async function POST(request:Request){
  try {
    const ctx=await requirePermission('inbox','send');
    const body=await request.json().catch(()=>null);
    if(!UUID_PATTERN.test(body?.id??''))return NextResponse.json({error:'Bienvenida invalida'},{status:400});
    const {data,error}=await ctx.supabase.rpc('complete_enrollment_welcome',{p_id:body.id});
    if(error)return NextResponse.json({error:'No puedes marcar esta bienvenida o ya vencieron las dos horas.'},{status:403});
    return NextResponse.json(data);
  }catch(error){return toErrorResponse(error);}
}
