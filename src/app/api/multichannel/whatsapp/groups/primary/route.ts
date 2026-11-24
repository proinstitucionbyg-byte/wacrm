import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { visibleSessionLines } from '@/lib/multichannel/session-line-visibility';
export async function GET(){try{
 const ctx=await getCurrentAccount(),db=supabaseAdmin();
 const [lines,states]=await Promise.all([db.from('multichannel_whatsapp_session_lines').select('line_key,linked_phone,worker_id,group_primary').eq('account_id',ctx.accountId),db.from('whatsapp_management_state').select('worker_id,snapshot').eq('account_id',ctx.accountId)]);
 if(lines.error||states.error)throw lines.error||states.error;
 const visible=visibleSessionLines(lines.data??[],states.data??[]);
 return Response.json({canChange:ctx.role==='owner',primary:visible.find(line=>line.group_primary)??null,lines:ctx.role==='owner'?visible:[]},{headers:{'Cache-Control':'no-store'}});
}catch(error){return toErrorResponse(error);}}
export async function POST(request:Request){try{
 const ctx=await requireRole('owner'),body=await request.json().catch(()=>null);
 if(!/^WA-[A-Za-z0-9_-]{1,60}$/.test(body?.line_key??'')||!/^\d{7,15}$/.test(body?.expected_phone??''))return Response.json({error:'Elige el número para grupos.'},{status:400});
 const db=supabaseAdmin();const [line,state]=await Promise.all([db.from('multichannel_whatsapp_session_lines').select('line_key,linked_phone,worker_id').eq('account_id',ctx.accountId).eq('line_key',body.line_key).eq('linked_phone',body.expected_phone).maybeSingle(),db.from('whatsapp_management_state').select('worker_id,snapshot').eq('account_id',ctx.accountId)]);
 if(line.error||state.error)throw line.error||state.error;
 if(!line.data||!visibleSessionLines([line.data],state.data??[]).length)return Response.json({error:'Ese número cambió o está archivado. Actualiza la lista.'},{status:409});
 const result=await db.rpc('set_whatsapp_group_primary',{p_account:ctx.accountId,p_actor:ctx.userId,p_line:body.line_key,p_phone:body.expected_phone});
 if(result.error)throw result.error;
 return Response.json({saved:true,groups_only:true,chats_unchanged:true});
}catch(error){return toErrorResponse(error);}}
