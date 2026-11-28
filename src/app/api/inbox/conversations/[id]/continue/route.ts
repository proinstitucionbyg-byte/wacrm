import {z} from 'zod';
import {requirePermission} from '@/lib/auth/permissions';
import {toErrorResponse} from '@/lib/auth/account';
import {supabaseAdmin} from '@/lib/automations/admin-client';
import {continuationContext,continueManually,ContinuationNotQueued} from '@/lib/whatsapp/manual-continuation';
const input=z.object({source_id:z.string().uuid().nullable(),line_key:z.string().regex(/^WA-[A-Za-z0-9_-]{1,60}$/),phone:z.string().regex(/^\d{7,15}$/),text:z.string().trim().min(1).max(4000),request_id:z.string().uuid()}).strict();
type Params={params:Promise<{id:string}>};
export async function GET(_request:Request,{params}:Params){try{const ctx=await requirePermission('inbox','send'),{id}=await params;if(!z.string().uuid().safeParse(id).success)return Response.json({error:'Chat inválido.'},{status:400});
 const visible=await ctx.supabase.from('conversations').select('id').eq('account_id',ctx.accountId).eq('id',id).maybeSingle();if(visible.error)throw visible.error;if(!visible.data)return Response.json({error:'Chat no disponible.'},{status:404});
 return Response.json(await continuationContext(supabaseAdmin(),ctx.accountId,id),{headers:{'Cache-Control':'no-store'}});
}catch(error){if(error instanceof ContinuationNotQueued)return Response.json({error:error.message,not_enqueued:true},{status:409});return toErrorResponse(error);}}
export async function POST(request:Request,{params}:Params){try{const ctx=await requirePermission('inbox','send'),{id}=await params;if(!z.string().uuid().safeParse(id).success)return Response.json({error:'Chat inválido.'},{status:400});
 const raw=await request.text();if(raw.length>16000)return Response.json({error:'Mensaje demasiado grande.'},{status:413});const parsed=input.safeParse(JSON.parse(raw));if(!parsed.success)return Response.json({error:'Revisa el número y el mensaje.'},{status:400});
 const visible=await ctx.supabase.from('conversations').select('id').eq('account_id',ctx.accountId).eq('id',id).maybeSingle();if(visible.error)throw visible.error;if(!visible.data)return Response.json({error:'Chat no disponible.'},{status:404});
 if(process.env.MULTICHANNEL_WHATSAPP_SESSION_SEND_ENABLED!=='true')return Response.json({error:'Los WhatsApp vinculados no están habilitados. No se enviará por Meta.'},{status:503});
 const b=parsed.data,result=await continueManually(supabaseAdmin(),{accountId:ctx.accountId,conversationId:id,senderId:ctx.userId,sourceId:b.source_id,lineKey:b.line_key,phone:b.phone,text:b.text,requestId:b.request_id});
 const message=await ctx.supabase.from('messages').select('*').eq('id',result.message_row_id).eq('conversation_id',id).maybeSingle();if(message.error)throw message.error;
 return Response.json({queued:true,...result,message:message.data},{headers:{'Cache-Control':'no-store'}});
}catch(error){if(error instanceof ContinuationNotQueued)return Response.json({error:error.message,not_enqueued:true},{status:409});return toErrorResponse(error);}}
