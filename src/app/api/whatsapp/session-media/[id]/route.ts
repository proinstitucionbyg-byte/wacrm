import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { SESSION_MEDIA_BUCKET, sessionMediaResponse } from '@/lib/whatsapp/session-received-media';
export const runtime='nodejs';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const ctx=await getCurrentAccount(),{id}=await params;
    if(!/^[0-9a-f-]{36}$/i.test(id))return Response.json({error:'Archivo no disponible.'},{status:404});
    const visible=await ctx.supabase.from('messages').select('id,media_url,whatsapp_session_line_key,conversations!inner(account_id)').eq('id',id).eq('conversations.account_id',ctx.accountId).maybeSingle();
    if(visible.error)throw visible.error;
    if(!visible.data?.whatsapp_session_line_key||visible.data.media_url!==`/api/whatsapp/session-media/${id}`)return Response.json({error:'Archivo no disponible para este usuario.'},{status:404});
    const file=await supabaseAdmin().storage.from(SESSION_MEDIA_BUCKET).download(`${ctx.accountId}/${id}`);
    if(file.error||!file.data)return Response.json({error:'El archivo todavía no está disponible. Se conserva su mensaje.'},{status:404});
    return sessionMediaResponse(file.data,request.headers.get('range'));
  }catch(error){return toErrorResponse(error);}
}
