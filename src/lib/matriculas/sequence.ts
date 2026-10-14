import type { SupabaseClient } from '@supabase/supabase-js';
import { runAutomationById } from '@/lib/automations/engine';
export function billingDay(startDate: string): 15 | 30 {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
    new Date(startDate).toISOString().slice(0, 10) !== startDate
  )
    throw Error('INICIO INVALIDO');
  const day = Number(startDate.slice(8));
  return day >= 10 && day <= 25 ? 15 : 30;
}
/** Reservations prevent webhook/document retries from duplicating a sequence. Failed sends remain for review. */
export async function startEnrollmentSequence(
  db: SupabaseClient,
  accountId: string,
  sourceId: string,
  stage: 'receipt' | 'final'
) {
  const table = stage === 'receipt' ? 'payment_reviews' : 'enrollment_drafts';
  const { data: source, error } = await db
    .from(table)
    .select('*')
    .eq('id', sourceId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (error) throw error;
  if (!source?.conversation_id) return;
  let paymentDay: 15 | 30 | undefined;
  let welcomed = false;
  if (stage === 'final') {
    if (source.status !== 'registered') return;
    const { data: review, error: reviewError } = await db
      .from('payment_reviews')
      .select('status')
      .eq('id', source.review_id)
      .eq('account_id', accountId)
      .maybeSingle();
    if (reviewError) throw reviewError;
    if (review?.status !== 'validated') return;
    const { data: deliveries, error: deliveryError } = await db
      .from('enrollment_document_deliveries')
      .select('kind,status')
      .eq('enrollment_id', sourceId)
      .eq('account_id', accountId);
    if (deliveryError) throw deliveryError;
    if (
      !['BOLETA', 'FICHA', 'CRONOGRAMA'].every((kind) =>
        deliveries?.some((item) => item.kind === kind && item.status === 'sent')
      )
    )
      return;
    const previous = await db.rpc('has_completed_intake_welcome', {
      p_account: accountId,
      p_enrollment: sourceId,
    });
    if (previous.error) throw previous.error;
    welcomed = previous.data === true;
    paymentDay = billingDay(source.data.start_date);
  } else if (source.status === 'rejected') return;
  const { data: automations, error: automationError } = await db
    .from('automations')
    .select('id,trigger_config')
    .eq('account_id', accountId)
    .eq('is_active', true)
    .contains('trigger_config', {
      internal_event:
        stage === 'receipt' ? 'receipt_received' : 'documents_sent',
    });
  if (automationError) throw automationError;
  const matches = (automations ?? []).filter(
    (a) => stage === 'receipt' || a.trigger_config.billing_day === paymentDay
  );
  if (matches.length !== 1)
    throw Error('LA SECUENCIA NECESITA UNA AUTOMATIZACION UNICA CONFIGURADA');
  const { data: conversation, error: convError } = await db
    .from('conversations')
    .select('contact_id')
    .eq('id', source.conversation_id)
    .eq('account_id', accountId)
    .maybeSingle();
  if (convError) throw convError;
  if (!conversation?.contact_id) return;
  const { data: run, error: reserveError } = await db
    .from('enrollment_sequence_runs')
    .insert({
      account_id: accountId,
      source_id: sourceId,
      stage,
      conversation_id: source.conversation_id,
      automation_id: matches[0].id,
      ...(stage === 'final'
        ? {
            welcome_due_at: new Date(
              Date.now() + 2 * 60 * 60 * 1000
            ).toISOString(),
            ...(welcomed ? { completed_at: new Date().toISOString() } : {}),
          }
        : {}),
    })
    .select('id')
    .single();
  if (reserveError?.code === '23505') return;
  if (reserveError || !run)
    throw reserveError ?? Error('NO SE PUDO RESERVAR LA SECUENCIA');
  if (stage === 'final' && welcomed) {
    const { error: closeError } = await db
      .from('enrollment_sequence_runs')
      .update({ status: 'closed', error: null })
      .eq('id', run.id)
      .eq('account_id', accountId);
    if (closeError) throw closeError;
    return true;
  }
  const launched = await runAutomationById({
    accountId,
    automationId: matches[0].id,
    contactId: conversation.contact_id,
    conversationId: source.conversation_id,
    sequenceId: run.id,
  });
  const { error: saveError } = await db
    .from('enrollment_sequence_runs')
    .update({
      status: launched ? 'started' : 'review',
      error: launched
        ? null
        : 'REVISAR EL CHAT ANTES DE REINTENTAR LA SECUENCIA',
    })
    .eq('id', run.id)
    .eq('account_id', accountId);
  if (saveError) throw saveError;
  return launched;
}

/** PDF delivery is already committed. Report a broken continuation without resending it. */
export async function resumeEnrollmentAfterDocuments(
  db: SupabaseClient,
  accountId: string,
  sourceId: string
) {
  try {
    const launched = await startEnrollmentSequence(db, accountId, sourceId, 'final');
    if (launched === false) throw Error('NO SE CONFIRMO LA AUTOMATIZACION FINAL');
  } catch (error) {
    console.error('[matriculas] final sequence needs review', error);
    try {
      const { data: draft, error: draftError } = await db
        .from('enrollment_drafts').select('conversation_id')
        .eq('id', sourceId).eq('account_id', accountId).maybeSingle();
      if (draftError) throw draftError;
      if (!draft?.conversation_id) return;
      const { data: profiles, error: profileError } = await db
        .from('profiles').select('user_id,account_role,area').eq('account_id', accountId);
      if (profileError) throw profileError;
      const recipients = (profiles ?? []).filter(p =>
        ['owner', 'admin'].includes(p.account_role) ||
        p.area?.trim().toUpperCase() === 'FIDELIZACION');
      if (!recipients.length) return;
      const { error: noticeError } = await db.from('notifications').upsert(
        recipients.map(p => ({
          account_id: accountId, user_id: p.user_id, type: 'system_notice',
          conversation_id: draft.conversation_id,
          title: 'REVISAR CONTINUACION · DOCUMENTOS ENVIADOS',
          body: 'LOS PDF YA ENVIADOS NO SE REPETIRAN. NO SE PUDO CONFIRMAR LA AUTOMATIZACION FINAL. REVISA EL CHAT Y LA BIENVENIDA ANTES DE REINTENTAR.',
          target_url: '/inbox?c=' + draft.conversation_id,
          dedup_key: 'enrollment-final-error:' + sourceId,
        })),
        { onConflict: 'account_id,user_id,dedup_key', ignoreDuplicates: true }
      );
      if (noticeError) throw noticeError;
    } catch (noticeError) {
      // A notification failure cannot turn a delivered PDF into an uncertain send.
      console.error('[matriculas] final sequence notification failed', noticeError);
    }
  }
}
