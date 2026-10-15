import type { SupabaseClient } from '@supabase/supabase-js';
import { sendMessageToConversation } from '@/lib/whatsapp/send-message';
import { normalizePhone } from '@/lib/whatsapp/phone-utils';

const WINDOW_MS = 24 * 60 * 60 * 1000;
// Leave a minute of margin for the Meta request after the last-inbound check.
const SEND_MARGIN_MS = 60_000;

export function isWithinWhatsAppReplyWindow(lastInbound: string | null, now = Date.now()): boolean {
  if (!lastInbound) return false;
  const time = Date.parse(lastInbound);
  return Number.isFinite(time) && time <= now && now - time < WINDOW_MS - SEND_MARGIN_MS;
}

export async function dispatchDueReminderMessages(db: SupabaseClient): Promise<number> {
  const { data: stale, error: staleError } = await db.from('adviser_reminders')
    .select('id,account_id,user_id,conversation_id')
    .eq('action_kind', 'message').eq('status', 'dispatching')
    .lt('dispatch_claimed_at', new Date(Date.now() - 30 * 60_000).toISOString()).limit(50);
  if (staleError) throw staleError;
  for (const item of stale ?? []) {
    const { data: blocked, error: blockError } = await db.from('adviser_reminders')
      .update({ status: 'blocked', dispatch_error: 'El servidor se interrumpió durante el envío. Revisa el chat antes de reenviar.' })
      .eq('id', item.id).eq('status', 'dispatching').select('id').maybeSingle();
    if (blockError) throw blockError;
    if (blocked) await db.from('notifications').insert({ account_id: item.account_id,
      user_id: item.user_id, type: 'system_notice', conversation_id: item.conversation_id,
      title: 'REVISAR MENSAJE PROGRAMADO',
      body: 'El servidor se interrumpió durante el envío. Revisa el chat antes de reenviar.',
      target_url: `/inbox?c=${item.conversation_id}`, dedup_key: `scheduled-reminder:${item.id}` });
  }
  const { data: due, error } = await db.from('adviser_reminders')
    .select('id,account_id,user_id,conversation_id,destination_phone,message_text,due_at')
    .eq('action_kind', 'message').eq('status', 'active')
    .lte('due_at', new Date().toISOString()).order('due_at').limit(50);
  if (error) throw error;
  let processed = 0;
  for (const item of due ?? []) {
    // One claim per reminder. A crash leaves it claimed for manual review;
    // automatic retry could duplicate a message already accepted by Meta.
    const { data: claim, error: claimError } = await db.from('adviser_reminders')
      .update({ status: 'dispatching', dispatch_claimed_at: new Date().toISOString() })
      .eq('id', item.id).eq('status', 'active')
      .select('id').maybeSingle();
    if (claimError) throw claimError;
    if (!claim) continue;
    processed++;
    let failure: string | null = null;
    try {
      if (Date.now() - Date.parse(item.due_at) > 5 * 60_000) {
        throw new Error('La hora programada pasó hace más de 5 minutos. No se envió para evitar un mensaje tardío.');
      }
      const { data: profile, error: profileError } = await db.from('profiles')
        .select('user_id').eq('user_id', item.user_id).eq('account_id', item.account_id).maybeSingle();
      if (profileError || !profile) throw new Error('La persona que programó el envío ya no tiene acceso al CRM.');
      const { data: chat, error: chatError } = await db.from('conversations')
        .select('id,contact:contacts(phone,channel,external_id,account_id)').eq('id', item.conversation_id)
        .eq('account_id', item.account_id).single();
      if (chatError || !chat) throw new Error('El chat ya no está disponible.');
      const contact = Array.isArray(chat.contact) ? chat.contact[0] : chat.contact;
      const normalized = normalizePhone(contact?.phone || '');
      if (contact?.account_id !== item.account_id ||
        !(contact.channel === 'whatsapp' || contact.channel == null && !contact.external_id) ||
        ![item.destination_phone, `51${item.destination_phone}`].includes(normalized)) {
        throw new Error('El número del chat cambió; se canceló el envío.');
      }
      const { data: inbound, error: inboundError } = await db.from('messages')
        .select('created_at').eq('conversation_id', item.conversation_id)
        .eq('sender_type', 'customer').order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (inboundError) throw inboundError;
      if (!isWithinWhatsAppReplyWindow(inbound?.created_at || null)) {
        throw new Error('La ventana de WhatsApp de 24 horas ya cerró. No se envió el mensaje.');
      }
      await sendMessageToConversation(db, item.account_id, {
        senderId: item.user_id, conversationId: item.conversation_id,
        messageType: 'text', contentText: item.message_text,
      });
    } catch (error) {
      failure = error instanceof Error ? error.message : 'Error al enviar el mensaje.';
      console.error('[reminders] scheduled message failed', item.id, failure);
    }
    const status = failure ? 'blocked' : 'done';
    const { data: completed, error: updateError } = await db.from('adviser_reminders')
      .update({ status, dispatch_error: failure }).eq('id', item.id).eq('status', 'dispatching')
      .select('id').maybeSingle();
    if (updateError) console.error('[reminders] could not finish job', item.id, updateError);
    if (!completed) continue;
    const { error: noticeError } = await db.from('notifications').insert({
      account_id: item.account_id, user_id: item.user_id, type: 'system_notice',
      conversation_id: item.conversation_id,
      title: failure ? 'REVISAR MENSAJE PROGRAMADO' : 'MENSAJE PROGRAMADO ENVIADO',
      body: failure ? `${failure} Revisa el chat antes de reenviarlo.`
        : `Se envió el mensaje programado al ${item.destination_phone}.`,
      target_url: `/inbox?c=${item.conversation_id}`,
      dedup_key: `scheduled-reminder:${item.id}`,
    });
    if (noticeError) console.error('[reminders] could not notify adviser', item.id, noticeError);
  }
  return processed;
}
