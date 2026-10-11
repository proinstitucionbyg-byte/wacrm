import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from '@/lib/auth/permissions';
import { toErrorResponse } from '@/lib/auth/account';
import { UUID_PATTERN } from '@/lib/team-chat';

export async function DELETE(req: NextRequest) {
  try {
    const ctx=await requirePermission('inbox_management','messages');
    const input=await req.json().catch(()=>null);
    if(!Array.isArray(input?.messageIds)||!input.messageIds.length||input.messageIds.length>100||!input.messageIds.every((id:unknown)=>typeof id==='string'&&UUID_PATTERN.test(id)))
      return NextResponse.json({error:'Selecciona entre 1 y 100 mensajes válidos.'},{status:400});
    const ids=[...new Set<string>(input.messageIds)];
    const {data,error}=await ctx.supabase.from('messages').select('id').in('id',ids);
    if(error)throw error;
    if(data?.length!==ids.length)return NextResponse.json({error:'No tienes acceso a todos los mensajes seleccionados.'},{status:403});
    const {error:hideError}=await ctx.supabase.from('inbox_hidden_messages').upsert(ids.map(message_id=>({user_id:ctx.userId,message_id})),{onConflict:'user_id,message_id',ignoreDuplicates:true});
    if(hideError)throw hideError;
    return NextResponse.json({ok:true,hidden:ids,scope:'only_me'});
  } catch (err) {
    return toErrorResponse(err);
  }
}
