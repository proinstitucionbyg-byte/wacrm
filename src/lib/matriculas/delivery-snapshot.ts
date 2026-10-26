import type { SupabaseClient } from '@supabase/supabase-js';

export interface EnrollmentDeliverySnapshot {
  kind: string;
  status: string;
  message_status: string | null;
  delivered_at: string | null;
}

/** Read existing delivery evidence for one bounded, authorized enrollment page.
 * A send reservation is not proof of delivery; the message must also match its chat. */
export async function readEnrollmentDeliverySnapshots(
  db: SupabaseClient,
  account: string,
  enrollments: Array<{ id: string; conversation_id: string }>,
): Promise<Map<string, EnrollmentDeliverySnapshot[]>> {
  const result = new Map<string, EnrollmentDeliverySnapshot[]>();
  if (!enrollments.length) return result;
  const chats = new Map(enrollments.map(row => [row.id, row.conversation_id]));
  const { data: deliveries, error } = await db.from('enrollment_document_deliveries')
    .select('enrollment_id,kind,status,whatsapp_message_id')
    .eq('account_id', account).in('enrollment_id', [...chats.keys()]);
  if (error) throw error;
  const ids = [...new Set((deliveries ?? []).map(row => row.whatsapp_message_id).filter(Boolean))];
  const messages = new Map<string, { status: string; billing_delivered_at: string | null }>();
  if (ids.length) {
    const { data, error: messageError } = await db.from('messages')
      .select('conversation_id,message_id,status,billing_delivered_at')
      .in('conversation_id', [...new Set(chats.values())]).in('message_id', ids);
    if (messageError) throw messageError;
    for (const message of data ?? []) messages.set(`${message.conversation_id}:${message.message_id}`, message);
  }
  for (const delivery of deliveries ?? []) {
    if (!chats.has(delivery.enrollment_id) || !['BOLETA', 'CRONOGRAMA', 'FICHA'].includes(delivery.kind)) continue;
    const message = messages.get(`${chats.get(delivery.enrollment_id)}:${delivery.whatsapp_message_id}`);
    const confirmed = delivery.status === 'sent' && ['delivered', 'read'].includes(message?.status ?? '');
    const rows = result.get(delivery.enrollment_id) ?? [];
    rows.push({ kind: delivery.kind, status: delivery.status,
      message_status: delivery.status === 'sent' ? message?.status ?? null : null,
      delivered_at: confirmed ? message?.billing_delivered_at ?? null : null });
    result.set(delivery.enrollment_id, rows);
  }
  return result;
}
