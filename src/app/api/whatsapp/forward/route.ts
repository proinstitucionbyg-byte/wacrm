import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { toErrorResponse } from '@/lib/auth/account';
import { UUID_PATTERN } from '@/lib/team-chat';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { sendMessageToConversation, SendMessageError } from '@/lib/whatsapp/send-message';

export async function POST(req: Request) {
  try {
    const ctx = await requirePermission('inbox', 'send');
    const limit = checkRateLimit('send:'+ctx.userId, RATE_LIMITS.send);
    if (!limit.success) return rateLimitResponse(limit);
    const input = await req.json().catch(() => null);
    if (!UUID_PATTERN.test(input?.messageId ?? '') || !UUID_PATTERN.test(input?.conversationId ?? ''))
      return NextResponse.json({error:'Selecciona un mensaje y un chat de destino validos.'},{status:400});
    // RLS enforces access to the original, including restricted transfer history.
    const {data:message,error} = await ctx.supabase.from('messages').select('*').eq('id',input.messageId).single();
    if (error || !message) return NextResponse.json({error:'No puedes acceder al mensaje original.'},{status:404});
    const {data:target,error:targetError} = await ctx.supabase.from('conversations').select('id,contact:contacts(channel)').eq('id',input.conversationId).eq('account_id',ctx.accountId).maybeSingle();
    if (targetError || !target) return NextResponse.json({error:'No puedes acceder al chat de destino.'},{status:404});
    const contact = Array.isArray(target.contact) ? target.contact[0] : target.contact;
    if (contact?.channel !== 'whatsapp') return NextResponse.json({error:'Selecciona un chat de WhatsApp.'},{status:400});
    // Only the recipient's last inbound message opens its window. The age or
    // closed status of the original conversation must not block forwarding.
    const {data:inbound,error:windowError} = await ctx.supabase.from('messages').select('created_at').eq('conversation_id',target.id).eq('sender_type','customer').order('created_at',{ascending:false}).limit(1).maybeSingle();
    if (windowError) throw windowError;
    const elapsed = Date.now() - Date.parse(inbound?.created_at ?? '');
    if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= 24*60*60*1000)
      return NextResponse.json({error:'El destino esta fuera de su ventana de 24 horas. Elige un chat con mensaje reciente del estudiante.'},{status:400});
    const plain = message.content_type === 'template' || (message.content_type === 'interactive' && !message.interactive_payload);
    const result = await sendMessageToConversation(ctx.supabase,ctx.accountId,{
      senderId:ctx.userId,
      conversationId:target.id,
      messageType:plain ? 'text' : message.content_type,
      contentText:message.content_text,
      mediaUrl:message.media_url,
      interactivePayload:plain ? undefined : message.interactive_payload,
      // Forwarding is not replying to an inaccessible message in another chat.
      // The existing transport resolves private Meta media before sending.
    });
    return NextResponse.json({success:true,message_id:result.messageId,whatsapp_message_id:result.whatsappMessageId});
  } catch (error) {
    if (error instanceof SendMessageError) return NextResponse.json({error:error.message},{status:error.status});
    return toErrorResponse(error);
  }
}
