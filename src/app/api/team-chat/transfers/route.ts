import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { UUID_PATTERN } from '@/lib/team-chat';
export async function GET(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const thread = new URL(request.url).searchParams.get('thread');
    if (!UUID_PATTERN.test(thread ?? '')) return NextResponse.json({error:'Selecciona un chat interno.'},{status:400});
    const {data,error} = await ctx.supabase.from('team_transfer_requests').select('id,conversation_id,sender_id,recipient_id,full_history,contact_label,status,created_at,resolved_at').eq('account_id',ctx.accountId).eq('thread_id',thread).order('created_at',{ascending:false}).limit(30);
    if (error) throw error;
    return NextResponse.json({requests:data ?? []});
  } catch(error) { return toErrorResponse(error); }
}
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const body = await request.json().catch(()=>null);
    if (!UUID_PATTERN.test(body?.thread ?? '') || !UUID_PATTERN.test(body?.conversation ?? '') || !UUID_PATTERN.test(body?.recipient ?? '') || typeof body?.full_history !== 'boolean')
      return NextResponse.json({error:'Selecciona chat, destinatario e historial.'},{status:400});
    const {data,error} = await ctx.supabase.rpc('request_team_transfer',{p_thread:body.thread,p_conversation:body.conversation,p_recipient:body.recipient,p_full_history:body.full_history});
    if (error) return NextResponse.json({error:error.code==='23505' ? 'Este chat ya tiene una solicitud pendiente.' : 'No puedes solicitar esta derivacion con ese historial o destinatario.'},{status:403});
    return NextResponse.json({id:data},{status:201});
  } catch(error) { return toErrorResponse(error); }
}
export async function PATCH(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const body = await request.json().catch(()=>null);
    if (!UUID_PATTERN.test(body?.id ?? '') || typeof body?.accept !== 'boolean') return NextResponse.json({error:'Solicitud invalida.'},{status:400});
    const {data,error} = await ctx.supabase.rpc('resolve_team_transfer',{p_request:body.id,p_accept:body.accept});
    if (error) return NextResponse.json({error:'No puedes resolver esta solicitud. Revisa tus permisos.'},{status:403});
    return NextResponse.json(data);
  } catch(error) { return toErrorResponse(error); }
}
