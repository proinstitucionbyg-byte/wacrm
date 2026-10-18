import type { SupabaseClient } from '@supabase/supabase-js';
import { runAutomationById } from '@/lib/automations/engine';
import { routeConversationToArea } from '@/lib/ai/handoff-routing';
import { ENROLLMENT_FIELDS, isMinor, type EnrollmentData } from './enrollment';

const HOUR = 3600000;
export type IncompletePhase =
  'provisional' | 'intake_followup' | 'intake_lastcall';
export function incompletePhase(
  now: number,
  due: number,
  lastInbound: number,
  welcomed: number | null,
  followupSent: boolean,
  lastcallSent: boolean
): IncompletePhase | null {
  if (!Number.isFinite(lastInbound) || now >= lastInbound + 24 * HOUR)
    return null;
  if (!welcomed)
    return now >= Math.min(due, lastInbound + 23 * HOUR) ? 'provisional' : null;
  // Before closing the channel window takes precedence over a late reminder.
  if (!lastcallSent && now >= lastInbound + 23 * HOUR) return 'intake_lastcall';
  if (!followupSent && now >= welcomed + 4 * HOUR && !lastcallSent)
    return 'intake_followup';
  return null;
}
export function missingWrittenFields(data: EnrollmentData): string[] {
  const result: string[] = (
    [
      'full_name',
      'document_type',
      'document_number',
      'birth_date',
      'phone1',
      'email',
      'address',
      'department',
      'district',
      'course',
    ] as const
  )
    .filter((key) => !data[key]?.trim())
    .map((key) => ENROLLMENT_FIELDS[key]);
  if (!data.identity_message_ids?.length && !data.declaration_message_ids?.length)
    result.push(
      'FOTO DEL DOCUMENTO O DATOS COMPLETOS POR ESCRITO PARA CONSERVAR SU PANTALLAZO'
    );
  if (isMinor(data.birth_date) && !data.guardian_message_ids?.length)
    result.push('DNI DEL TUTOR O PADRES');
  return result;
}
export function fidelityReviewTasks(data: EnrollmentData): string[] {
  const tasks = missingWrittenFields(data);
  if (data.identity_message_ids?.length && !data.identity_confirmed)
    tasks.push('VERIFICAR DNI YA RECIBIDO; NO PEDIR OTRA FOTO SI ES LEGIBLE');
  if (!data.offer_confirmed || data.prices?.length !== 6)
    tasks.push('CONFIRMAR PROMOCION Y SEIS CUOTAS SEGUN EL BLOQUE ENVIADO');
  return tasks;
}
export function incompleteIntakeText(
  phase: IncompletePhase,
  data: EnrollmentData
): string {
  const fields = missingWrittenFields(data);
  const introduction =
    phase === 'provisional'
      ? '¡Bienvenido(a) a INSTICRECE! Tu pago fue validado. Todavía no podemos emitir tu boleta, cronograma de pagos y ficha de matrícula porque necesitamos completar tu registro. Fidelización te acompañará con este trámite.'
      : phase === 'intake_followup'
        ? 'Queremos ayudarte a completar tu matrícula. Tus documentos siguen pendientes de completar el registro.'
        : 'Antes de que termine nuestra ventana de atención, déjanos los datos pendientes y confirma tu celular, correo y un contacto alternativo si lo tienes, para que fidelización pueda continuar ayudándote.';
  return (
    introduction +
    '\n\n' +
    (fields.length
      ? 'Por favor envíanos:\n' + fields.map((field) => '• ' + field).join('\n')
      : 'Estamos revisando la información recibida para completar tus documentos. Si detectamos alguna diferencia, te pediremos aclararla.') +
    '\n\nSi perdiste tu documento, puedes escribir tus datos y su número; conservaremos el pantallazo como respaldo. Si tampoco recuerdas el número, indícanoslo para que fidelización te ayude. No completaremos datos por ti.'
  );
}

/** Server scheduler only. New validated payments enter the queue through a DB trigger.
 * Reservations are at-most-once: uncertain sends remain for human review. */
export async function runIncompleteIntakes(db: SupabaseClient) {
  const { data: watches, error } = await db
    .from('incomplete_intake_watches')
    .select('*')
    .is('closed_at', null)
    .order('checked_at', { ascending: true })
    .limit(25);
  if (error) throw error;
  for (const watch of watches ?? []) {
    const now = Date.now(),
      stamp = new Date(now).toISOString();
    const checked = await db
      .from('incomplete_intake_watches')
      .update({ checked_at: stamp })
      .eq('enrollment_id', watch.enrollment_id);
    if (checked.error) throw checked.error;
    const { data: draft, error: draftError } = await db
      .from('enrollment_drafts')
      .select('status,data,review_id')
      .eq('id', watch.enrollment_id)
      .eq('account_id', watch.account_id)
      .maybeSingle();
    if (draftError) throw draftError;
    const { data: review, error: reviewError } = await db
      .from('payment_reviews')
      .select('status,payment_purpose')
      .eq('id', draft?.review_id)
      .eq('account_id', watch.account_id)
      .maybeSingle();
    if (reviewError) throw reviewError;
    if (
      !draft ||
      review?.status !== 'validated' || ['tuition','other'].includes(review.payment_purpose)||
      draft.status !== 'collecting'
    ) {
      const closed = await db
        .from('incomplete_intake_watches')
        .update({ closed_at: stamp })
        .eq('enrollment_id', watch.enrollment_id);
      if (closed.error) throw closed.error;
      continue;
    }
    const { data: conversation, error: convError } = await db
      .from('conversations')
      .select('contact_id')
      .eq('id', watch.conversation_id)
      .eq('account_id', watch.account_id)
      .maybeSingle();
    if (convError) throw convError;
    if (!conversation) continue;
    const { data: messages, error: messageError } = await db
      .from('messages')
      .select('created_at')
      .eq('conversation_id', watch.conversation_id)
      .eq('sender_type', 'customer')
      .order('created_at', { ascending: false })
      .limit(1);
    if (messageError) throw messageError;
    const lastInbound = Date.parse(messages?.[0]?.created_at ?? '');
    const { data: sequences, error: seqError } = await db
      .from('enrollment_sequence_runs')
      .select('id,stage,status,completed_at,completed_by,backup_sent_at')
      .eq('account_id', watch.account_id)
      .eq('source_id', watch.enrollment_id);
    if (seqError) throw seqError;
    const welcome = sequences?.find((row) => row.stage === 'provisional');
    const welcomed = welcome?.completed_at ?? welcome?.backup_sent_at;
    const { data: profiles, error: profileError } = await db
      .from('profiles')
      .select('user_id,account_role,area')
      .eq('account_id', watch.account_id);
    if (profileError) throw profileError;
    const recipients = (profiles ?? []).filter(
      (p) =>
        ['owner', 'admin'].includes(p.account_role) ||
        p.area?.trim().toUpperCase() === 'FIDELIZACION'
    );
    const owner = profiles?.find((p) => p.account_role === 'owner');
    if (!owner) continue;
    const body =
      'PAGO VALIDADO · DATOS PENDIENTES · DOCUMENTOS NO EMITIDOS\n' +
      fidelityReviewTasks(draft.data).join('\n') +
      '\nFIDELIZACION DEBE COMPLETAR EL REGISTRO Y GESTIONAR EL ACCESO A CLASE CON UN ENLACE VERIFICADO. NO INVENTAR EL ENLACE.\nPLAZO DE BIENVENIDA: ' +
      new Date(watch.welcome_due_at).toLocaleString('es-PE', {
        timeZone: 'America/Lima',
      });
    const notices = await db.from('notifications').upsert(
      recipients.map((p) => ({
        account_id: watch.account_id,
        user_id: p.user_id,
        type: 'system_notice',
        conversation_id: watch.conversation_id,
        title: 'PAGO VALIDADO · DATOS PENDIENTES',
        body,
        target_url: '/inbox?c=' + watch.conversation_id,
        dedup_key: 'incomplete:' + watch.enrollment_id,
      })),
      { onConflict: 'account_id,user_id,dedup_key', ignoreDuplicates: true }
    );
    if (notices.error) throw notices.error;
    if (Number.isFinite(lastInbound) && now >= lastInbound + 24 * HOUR) {
      const expired = await db.from('notifications').upsert(
        recipients.map((p) => ({
          account_id: watch.account_id,
          user_id: p.user_id,
          type: 'system_notice',
          conversation_id: watch.conversation_id,
          title: 'VENTANA CERRADA · DATOS PENDIENTES',
          body: 'NO SE ENVIARON MENSAJES LIBRES FUERA DE LA VENTANA. FIDELIZACION DEBE CONTINUAR POR UN MEDIO AUTORIZADO O UNA PLANTILLA CONFIGURADA. EL EXPEDIENTE SIGUE PENDIENTE.',
          target_url: '/inbox?c=' + watch.conversation_id,
          dedup_key: 'incomplete-window:' + watch.enrollment_id,
        })),
        { onConflict: 'account_id,user_id,dedup_key', ignoreDuplicates: true }
      );
      if (expired.error) throw expired.error;
    }
    if (!welcome) {
      await routeConversationToArea(
        db,
        watch.account_id,
        watch.conversation_id,
        'fidelizacion'
      );
      const { data: blocks, error: blockError } = await db
        .from('automations')
        .select('id')
        .eq('account_id', watch.account_id)
        .eq('is_active', true)
        .contains('trigger_config', {
          internal_event: 'provisional',
          internal_only: true,
        });
      if (blockError) throw blockError;
      if (blocks?.length !== 1) continue;
      const reserved = await db
        .from('enrollment_sequence_runs')
        .insert({
          account_id: watch.account_id,
          source_id: watch.enrollment_id,
          stage: 'provisional',
          conversation_id: watch.conversation_id,
          automation_id: blocks[0].id,
          status: 'started',
          welcome_due_at: watch.welcome_due_at,
        });
      if (reserved.error && reserved.error.code !== '23505')
        throw reserved.error;
      // Reload on the next tick, so a concurrent human check is honored.
      continue;
    }
    const phase = incompletePhase(
      now,
      Date.parse(watch.welcome_due_at),
      lastInbound,
      welcomed ? Date.parse(welcomed) : null,
      Boolean(sequences?.some((row) => row.stage === 'intake_followup')),
      Boolean(sequences?.some((row) => row.stage === 'intake_lastcall'))
    );
    if (!phase) continue;
    const { data: blocks, error: blockError } = await db
      .from('automations')
      .select('id')
      .eq('account_id', watch.account_id)
      .eq('is_active', true)
      .contains('trigger_config', {
        internal_event: phase,
        internal_only: true,
      });
    if (blockError) throw blockError;
    if (blocks?.length !== 1) continue;
    const { data: steps, error: stepsError } = await db
      .from('automation_steps')
      .select('step_type,parent_step_id')
      .eq('automation_id', blocks[0].id);
    if (stepsError) throw stepsError;
    // This queue schedules time itself. A nested wait would otherwise be marked as sent prematurely.
    if (
      !steps?.length ||
      steps.some(
        (step) =>
          step.parent_step_id ||
          !['send_message', 'send_media'].includes(step.step_type)
      )
    )
      continue;
    let id = welcome.id;
    if (phase !== 'provisional') {
      const reserved = await db
        .from('enrollment_sequence_runs')
        .insert({
          account_id: watch.account_id,
          source_id: watch.enrollment_id,
          stage: phase,
          conversation_id: watch.conversation_id,
          automation_id: blocks[0].id,
          status: 'started',
        })
        .select('id')
        .single();
      if (reserved.error?.code === '23505') continue;
      if (reserved.error || !reserved.data)
        throw reserved.error ?? new Error('No se reservó el seguimiento');
      id = reserved.data.id;
    }
    const claim = await db
      .from('enrollment_sequence_runs')
      .update({ status: 'running' })
      .eq('id', id)
      .eq('account_id', watch.account_id)
      .eq('status', 'started')
      .is('completed_at', null)
      .is('backup_sent_at', null)
      .select('id')
      .maybeSingle();
    if (claim.error) throw claim.error;
    if (!claim.data) continue;
    const sent = await runAutomationById({
      accountId: watch.account_id,
      automationId: blocks[0].id,
      contactId: conversation.contact_id,
      conversationId: watch.conversation_id,
      sequenceId: id,
      requireComplete: true,
      messageText: incompleteIntakeText(phase, draft.data),
    });
    const saved = await db
      .from('enrollment_sequence_runs')
      .update(
        sent
          ? { status: 'started', backup_sent_at: new Date().toISOString() }
          : {
              status: 'review',
              error:
                'REVISAR ENVIO DE DATOS PENDIENTES; NO REINTENTAR SIN VER EL CHAT',
            }
      )
      .eq('id', id)
      .eq('account_id', watch.account_id);
    if (saved.error) throw saved.error;
    if (!sent) {
      const failed = await db.from('notifications').upsert(
        recipients.map((p) => ({
          account_id: watch.account_id,
          user_id: p.user_id,
          type: 'system_notice',
          conversation_id: watch.conversation_id,
          title: 'REVISAR ENVIO · REGISTRO INCOMPLETO',
          body:
            'NO SE CONFIRMO EL BLOQUE ' +
            phase.toUpperCase() +
            '. REVISA EL CHAT ANTES DE REINTENTAR PARA EVITAR ENVIOS DUPLICADOS.',
          target_url: '/inbox?c=' + watch.conversation_id,
          dedup_key: 'incomplete-error:' + watch.enrollment_id + ':' + phase,
        })),
        { onConflict: 'account_id,user_id,dedup_key', ignoreDuplicates: true }
      );
      if (failed.error) throw failed.error;
    }
    if (sent && phase === 'provisional') {
      const completed = await db
        .from('enrollment_sequence_runs')
        .update({ completed_at: new Date().toISOString() })
        .eq('account_id', watch.account_id)
        .eq('source_id', watch.enrollment_id)
        .eq('stage', 'final')
        .is('completed_at', null)
        .is('backup_sent_at', null);
      if (completed.error) throw completed.error;
    }
  }
}
