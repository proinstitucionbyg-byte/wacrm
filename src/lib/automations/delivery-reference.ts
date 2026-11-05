import type { SupabaseClient } from '@supabase/supabase-js';

export const isSessionDeliveryReference = (id: string) => /^waweb-job:[0-9a-f-]{36}$/i.test(id);

/** Session jobs retain their identity when WhatsApp replaces the temporary message ID. */
export async function readDeliveryReference(db: SupabaseClient, accountId: string, conversationId: string, id: string) {
  if (isSessionDeliveryReference(id)) {
    const result = await db.from('whatsapp_session_outbound_jobs').select('status')
      .eq('id', id.slice('waweb-job:'.length)).eq('account_id', accountId).eq('conversation_id', conversationId).maybeSingle();
    return { status: ['cancelled', 'needs_review'].includes(result.data?.status ?? '') ? 'failed' : result.data?.status ?? null,
      error: !!result.error || !result.data };
  }
  const result = await db.from('messages').select('status').eq('conversation_id', conversationId).eq('message_id', id).maybeSingle();
  return { status: result.data?.status ?? null, error: !!result.error };
}

/** An actual acknowledgement can wake waits stored before the provider ID existed. */
export async function deliveryReferenceAliases(db: SupabaseClient, accountId: string, conversationId: string, id: string) {
  if (isSessionDeliveryReference(id)) return [id];
  const result = await db.from('whatsapp_session_outbound_jobs').select('id')
    .eq('account_id', accountId).eq('conversation_id', conversationId).eq('provider_message_id', id).limit(2);
  if (result.error) throw new Error('No se pudo comprobar el acuse de la sesión.');
  return [id, ...(result.data ?? []).map(row => `waweb-job:${row.id}`)];
}
