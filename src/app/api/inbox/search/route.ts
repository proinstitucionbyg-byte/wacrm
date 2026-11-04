import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { toErrorResponse } from '@/lib/auth/account';
import { UUID_PATTERN } from '@/lib/team-chat';
import { matchesPhoneSearch } from '@/lib/inbox/conversations';

export async function GET(request: Request) {
  try {
    const ctx=await requirePermission('inbox','view');
    const params=new URL(request.url).searchParams,query=params.get('q')?.trim()??'',conversation=params.get('conversation');
    const offset=Number(params.get('offset')??0);
    if(query.length<2||query.length>120||(conversation&&!UUID_PATTERN.test(conversation))||!Number.isInteger(offset)||offset<0||offset>10000)
      return NextResponse.json({error:'Escribe entre 2 y 120 caracteres.'},{status:400});
    const numeric=/^[+\d\s().-]+$/.test(query),digits=query.replace(/\D/g,'');
    const literal=query.replace(/[\\%_]/g,'\\$&');
    const pattern=numeric&&digits?'%'+digits.split('').join('%')+'%':'%'+literal+'%';
    let search=ctx.supabase.from('messages').select('id,conversation_id,content_text,created_at,sender_type,conversation:conversations!inner(account_id)')
      .eq('conversation.account_id',ctx.accountId).ilike('content_text',pattern);
    if(conversation)search=search.eq('conversation_id',conversation);
    const {data,error}=await search.order('created_at',{ascending:false}).order('id',{ascending:false}).range(offset,offset+199);
    if(error)throw error;
    const candidates=(data??[]).filter(row=>!numeric||matchesPhoneSearch(row.content_text??'',query));
    const hidden=candidates.length?await ctx.supabase.from('inbox_hidden_messages').select('message_id').in('message_id',candidates.map(row=>row.id)):{data:[],error:null};
    if(hidden.error)throw hidden.error;
    const hiddenIds=new Set((hidden.data??[]).map(row=>row.message_id));
    return NextResponse.json({matches:candidates.filter(row=>!hiddenIds.has(row.id)).map(row=>({id:row.id,conversationId:row.conversation_id,text:row.content_text,createdAt:row.created_at,senderType:row.sender_type})),hasMore:data?.length===200,nextOffset:offset+200},{headers:{'Cache-Control':'no-store'}});
  }catch(error){return toErrorResponse(error);}
}
