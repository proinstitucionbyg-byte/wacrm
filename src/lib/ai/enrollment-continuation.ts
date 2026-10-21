import type { SupabaseClient } from '@supabase/supabase-js'

/** A pending or approved enrollment payment blocks another payment request until registration documents are complete. */
export async function hasUnfinishedEnrollmentPayment(
  db: SupabaseClient, accountId: string, conversationId: string,
): Promise<boolean> {
  const { data: review, error: reviewError } = await db.from('payment_reviews')
    .select('id,status').eq('account_id', accountId).eq('conversation_id', conversationId)
    .eq('payment_purpose', 'enrollment').in('status', ['pending', 'validated'])
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (reviewError) throw reviewError
  if (!review) return false
  if (review.status === 'pending') return true
  const { data: draft, error: draftError } = await db.from('enrollment_drafts')
    .select('id,status').eq('account_id', accountId).eq('review_id', review.id).maybeSingle()
  if (draftError) throw draftError
  if (!draft || draft.status !== 'registered') return true
  const { data: deliveries, error: deliveriesError } = await db.from('enrollment_document_deliveries')
    .select('kind,status,whatsapp_message_id').eq('account_id', accountId).eq('enrollment_id', draft.id)
  if (deliveriesError) throw deliveriesError
  const required = ['BOLETA', 'FICHA', 'CRONOGRAMA']
  const sent = required.map(kind => deliveries?.find(delivery =>
    delivery.kind === kind && delivery.status === 'sent'))
  if (sent.some(delivery => !delivery?.whatsapp_message_id)) return true
  const messageIds = sent.map(delivery => delivery!.whatsapp_message_id as string)
  const { data: acknowledgements, error: ackError } = await db.from('messages')
    .select('message_id,status').eq('conversation_id', conversationId).in('message_id', messageIds)
  if (ackError) throw ackError
  return !messageIds.every(id => acknowledgements?.some(message =>
    message.message_id === id && ['delivered', 'read'].includes(message.status)))
}

/** A continuation after a received enrollment payment must not restart Yape/Plin. */
export async function paidEnrollmentContinuation(
  db: SupabaseClient, accountId: string, conversationId: string, text: string,
): Promise<string | null> {
  if (!/\b(?:sigamos|continuemos|continuar|seguir|sigue|ya pagu[eé]|ya hice el pago)\b/i.test(text)
      || !/inscripci[oó]n|matr[ií]cula|registro|pag[ou]/i.test(text)) return null
  const { data, error } = await db.from('payment_reviews')
    .select('status').eq('account_id', accountId).eq('conversation_id', conversationId)
    .eq('payment_purpose', 'enrollment').in('status', ['pending', 'validated'])
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (error) throw error
  if (!data) return null
  return data.status === 'validated'
    ? 'Tu comprobante de matrícula ya fue validado. ✅ Continuamos con tu registro usando los datos que nos compartiste; no necesitas volver a pagar. Una asesora revisará los documentos pendientes y te informará por aquí. 😊'
    : 'Ya recibimos tu comprobante y está pendiente de validación. ✅ Continuamos con tu registro usando los datos que nos compartiste; no necesitas volver a enviar el pago. Una asesora te informará por aquí. 😊'
}
