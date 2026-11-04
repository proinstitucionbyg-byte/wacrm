import type { SupabaseClient } from '@supabase/supabase-js';
import { createHash, randomUUID } from 'node:crypto';
import{currentSessionInbound}from'./session-inbound-context';

/** Prevents an unimplemented session channel from silently falling back to
 * the account's Meta Cloud number. The lookup stays dormant until the bridge
 * flag is enabled after its schema migration is applied. */
export async function getSessionOriginLineForConversation(
  db: SupabaseClient,
  conversationId: string,
): Promise<string | null> {
  if (process.env.MULTICHANNEL_WHATSAPP_SESSION_BRIDGE_ENABLED !== 'true') return null;

  const pinned=currentSessionInbound(conversationId);if(pinned)return pinned.lineKey;

  const { data, error } = await db.from('messages')
    .select('whatsapp_session_line_key')
    .eq('conversation_id', conversationId)
    .eq('sender_type', 'customer')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error('No se pudo verificar con seguridad el canal de esta conversación.');
  if(data?.whatsapp_session_line_key)return data.whatsapp_session_line_key;
  const support=await db.from('conversations').select('whatsapp_support_line_key,whatsapp_support_wait_until').eq('id',conversationId).maybeSingle();
  if(support.error)throw Error('No se pudo verificar la derivación a soporte; no se usará Cloud.');
  if(support.data?.whatsapp_support_wait_until&&!support.data.whatsapp_support_line_key)throw Error('Se está comprobando el origen de Meta antes de responder. La espera inicial es de tres minutos; si ya pasó, revisa la derivación antes de enviar.');
  return support.data?.whatsapp_support_line_key??null;
}

/** Refuse unsupported CRM payloads on a session line instead of using Meta Cloud. */
export async function rejectUnsupportedSessionTransport(
  db: SupabaseClient,
  conversationId: string,
  capability: 'template' | 'media' | 'interactive',
): Promise<void> {
  const lineKey = await getSessionOriginLineForConversation(db, conversationId);
  if (!lineKey) return;
  if (process.env.MULTICHANNEL_WHATSAPP_SESSION_SEND_ENABLED !== 'true') {
    throw new Error(`La conversación pertenece a la sesión ${lineKey}; la salida aún no está habilitada.`);
  }
  throw new Error(`La sesión ${lineKey} todavía no admite mensajes ${capability}; no se enviará por Meta Cloud.`);
}

/** Queue engine text on the originating WhatsApp Web line, never Meta Cloud. */
export async function enqueueSessionTextIfRequired(
  db: SupabaseClient,
  args: { accountId: string; conversationId: string; text: string; idempotencyKey?: string;menuOptions?:{id:string;title:string}[] },
): Promise<{ whatsapp_message_id: string } | null> {
  if (process.env.MULTICHANNEL_WHATSAPP_SESSION_BRIDGE_ENABLED !== 'true') return null;
  const pinned=currentSessionInbound(args.conversationId);
  if(pinned&&pinned.accountId!==args.accountId)throw Error('El origen de esta respuesta pertenece a otra cuenta.');
  let sourceQuery=db.from('messages')
    .select('id,message_id,whatsapp_session_line_key')
    .eq('conversation_id', args.conversationId).eq('sender_type', 'customer');
  if(pinned)sourceQuery=sourceQuery.eq('id',pinned.messageRowId).eq('whatsapp_session_line_key',pinned.lineKey);
  const { data: source, error: sourceError } = await sourceQuery
    .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(1).maybeSingle();
  if (sourceError) throw new Error('No se pudo verificar con seguridad el canal de esta conversación.');
  if(pinned&&(!source||source.id!==pinned.messageRowId||source.whatsapp_session_line_key!==pinned.lineKey))throw Error('No se pudo comprobar el origen exacto de la consulta.');
  const lineKey = source?.whatsapp_session_line_key;
  if (!lineKey) {
    const supportLine=await getSessionOriginLineForConversation(db,args.conversationId);
    if(!supportLine)return null;
    if(!source?.message_id)throw Error('No se confirmó la consulta original para soporte.');
    const dedupKey=createHash('sha256').update(args.idempotencyKey??`${source.message_id}\0${args.text}\0${JSON.stringify(args.menuOptions??null)}`).digest('hex');
    const {data,error}=await db.rpc('enqueue_cloud_support_reply',{p_account_id:args.accountId,p_conversation_id:args.conversationId,p_line_key:supportLine,p_provider_id:source.message_id,p_body:args.text,p_dedup_key:dedupKey,p_sender_id:null,p_options:args.menuOptions??null});
    if(error||typeof data?.message_id!=='string')throw Error('No se pudo guardar la respuesta por soporte; no se enviará por Cloud.');
    return {whatsapp_message_id:data.message_id};
  }
  if (process.env.MULTICHANNEL_WHATSAPP_SESSION_SEND_ENABLED !== 'true') {
    throw new Error(`La conversación pertenece a la sesión ${lineKey}; la salida aún no está habilitada.`);
  }
  if (typeof args.text !== 'string' || !args.text.trim()) {
    throw new Error('El mensaje de WhatsApp Web no tiene un origen válido.');
  }
  const { data: receipt, error: receiptError } = await db.from('whatsapp_session_inbound_receipts')
    .select('provider_message_id')
    .eq('account_id', args.accountId).eq('line_key', lineKey).eq('message_row_id', source.id).maybeSingle();
  if (receiptError || typeof receipt?.provider_message_id !== 'string') {
    throw new Error('No se pudo comprobar el mensaje entrante de esta sesión.');
  }
  if(pinned&&receipt.provider_message_id!==pinned.providerMessageId)throw Error('El recibo no corresponde a la consulta original.');
  const identity = args.idempotencyKey ?? `${receipt.provider_message_id}\0${args.text}${args.menuOptions?'\0'+JSON.stringify(args.menuOptions):''}`;
  const dedupKey = createHash('sha256').update(identity).digest('hex');
  const { data, error } = await db.rpc(args.menuOptions?'enqueue_whatsapp_session_text_menu':'enqueue_whatsapp_session_text', {
    p_account_id: args.accountId,
    p_conversation_id: args.conversationId,
    p_line_key: lineKey,
    p_inbound_provider_message_id: receipt.provider_message_id,
    p_body: args.text,
    p_dedup_key: dedupKey,
    ...(args.menuOptions?{p_options:args.menuOptions}:{}),
  });
  if (error || typeof data?.message_id !== 'string' || !data.message_id.startsWith('waweb-job:')) {
    throw new Error('No se pudo encolar la respuesta en su sesión WhatsApp.');
  }
  return { whatsapp_message_id: data.message_id };
}

/** Queue a human's Inbox text reply on the exact WhatsApp Web line that
 * received the latest customer message. Manual replies deliberately pause
 * the CRM engines inside the transactional database function. */
export async function enqueueSessionManualText(
  db: SupabaseClient,
  args: { accountId: string; conversationId: string; senderId: string; lineKey: string; text: string },
): Promise<{ messageId: string; whatsappMessageId: string }> {
  if (process.env.MULTICHANNEL_WHATSAPP_SESSION_SEND_ENABLED !== 'true') {
    throw new Error(`La conversación pertenece a la sesión ${args.lineKey}; la salida aún no está habilitada.`);
  }
  if (!args.text.trim()) throw new Error('Escribe un mensaje antes de enviarlo.');
  const dedupKey = createHash('sha256').update(
    `${args.senderId}\0${args.conversationId}\0${randomUUID()}`,
  ).digest('hex');
  const { data, error } = await db.rpc('enqueue_whatsapp_session_manual_text', {
    p_account_id: args.accountId,
    p_conversation_id: args.conversationId,
    p_line_key: args.lineKey,
    p_sender_id: args.senderId,
    p_body: args.text,
    p_dedup_key: dedupKey,
  });
  if (error || typeof data?.message_row_id !== 'string' || typeof data?.message_id !== 'string') {
    throw new Error('No se pudo encolar la respuesta en su sesión WhatsApp.');
  }
  return { messageId: data.message_row_id, whatsappMessageId: data.message_id };
}
