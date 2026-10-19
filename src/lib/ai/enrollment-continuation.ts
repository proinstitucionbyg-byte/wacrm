import type { SupabaseClient } from '@supabase/supabase-js'

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
