import type { SupabaseClient } from '@supabase/supabase-js';
import { routeConversationToArea } from '@/lib/ai/handoff-routing';
import { enrollmentIssues, type EnrollmentData } from './enrollment';

export const URGENT_PAID_INTAKE_TAG = 'URGENTE · EXPEDIENTE DE MATRÍCULA';

/** Paid enrollment cases belong to Fidelity; incomplete records stay visibly urgent there. */
export async function syncPaidEnrollmentHandoff(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
  draftId: string,
  data: EnrollmentData
) {
  const { data: conversation, error: conversationError } = await db
    .from('conversations')
    .select('contact_id,user_id,ai_handoff_area')
    .eq('account_id', accountId)
    .eq('id', conversationId)
    .maybeSingle();
  if (conversationError) throw conversationError;
  if (!conversation?.contact_id) return;

  if (conversation.ai_handoff_area !== 'FIDELIZACION')
    await routeConversationToArea(db, accountId, conversationId, 'fidelizacion');

  const { data: tags, error: tagError } = await db
    .from('tags')
    .select('id')
    .eq('account_id', accountId)
    .eq('name', URGENT_PAID_INTAKE_TAG)
    .limit(1);
  if (tagError) throw tagError;

  let urgentTagId = tags?.[0]?.id as string | undefined;
  if (!urgentTagId) {
    const { data: created, error: createError } = await db
      .from('tags')
      .insert({
        account_id: accountId,
        user_id: conversation.user_id,
        name: URGENT_PAID_INTAKE_TAG,
        color: '#ef4444',
        kind: 'process',
        audience: { users: [], areas: [], roles: [] },
      })
      .select('id')
      .single();
    if (createError) throw createError;
    urgentTagId = created?.id;
  }
  if (!urgentTagId) throw new Error('No se pudo crear la etiqueta urgente');

  const issues = enrollmentIssues(data);
  if (issues.length) {
    const { error: attachError } = await db.from('contact_tags').upsert(
      { contact_id: conversation.contact_id, tag_id: urgentTagId },
      { onConflict: 'contact_id,tag_id', ignoreDuplicates: true }
    );
    if (attachError) throw attachError;

    const { data: profiles, error: profileError } = await db
      .from('profiles')
      .select('user_id,account_role,area')
      .eq('account_id', accountId);
    if (profileError) throw profileError;
    const recipients = (profiles ?? []).filter((profile) =>
      ['owner', 'admin'].includes(profile.account_role) ||
      profile.area?.trim().toUpperCase() === 'FIDELIZACION'
    );
    if (recipients.length) {
      const { error: noticeError } = await db.from('notifications').upsert(
        recipients.map((profile) => ({
          account_id: accountId,
          user_id: profile.user_id,
          type: 'system_notice',
          conversation_id: conversationId,
          title: 'URGENTE · PAGO VALIDADO · EXPEDIENTE PENDIENTE',
          body: 'Fidelización debe revisar el expediente y completar estos puntos antes de emitir documentos:\n' +
            issues.map((issue) => '• ' + issue).join('\n') +
            '\nNo vuelvas a pedir datos que ya estén en el chat. No repitas medios de pago ni marques los documentos como enviados sin confirmar la entrega.',
          target_url: '/inbox?c=' + conversationId,
          dedup_key: 'paid-intake-incomplete:' + draftId,
          requires_action: true,
        })),
        // The same paid case can gain data later. Keep one notification, but
        // refresh its missing-fields list so advisers never ask again for
        // information that is already in the conversation.
        { onConflict: 'account_id,user_id,dedup_key' }
      );
      if (noticeError) throw noticeError;
    }
  } else {
    const { error: detachError } = await db
      .from('contact_tags')
      .delete()
      .eq('contact_id', conversation.contact_id)
      .eq('tag_id', urgentTagId);
    if (detachError) throw detachError;
    const { error: closeError } = await db
      .from('notifications')
      .update({ expires_at: new Date().toISOString() })
      .eq('account_id', accountId)
      .eq('dedup_key', 'paid-intake-incomplete:' + draftId);
    if (closeError) throw closeError;
  }
}
