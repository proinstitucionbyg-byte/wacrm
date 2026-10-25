import { createHash } from 'node:crypto';
import { requireApiKey } from '@/lib/auth/api-context';
import {
  ApiError,
  badRequest,
  ok,
  toApiErrorResponse,
} from '@/lib/api/v1/respond';
import { uploadMedia } from '@/lib/whatsapp/meta-api';
import { decrypt } from '@/lib/whatsapp/encryption';
import { engineSendMedia } from '@/lib/automations/meta-send';
import { UUID_PATTERN } from '@/lib/team-chat';
import { resumeEnrollmentAfterDocuments } from '@/lib/matriculas/sequence';
import { isSocialChannel, socialConfiguration } from '@/lib/social/meta-api';
import { saveSocialDocument } from '@/lib/social/storage';
import { readConversationBillingPreflight } from '@/lib/whatsapp/billing-runtime';

/** Receives only the three generated PDFs for an already registered and human-validated enrollment. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; kind: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'enrollments:sync');
    const { id, kind } = await params;
    if (
      !UUID_PATTERN.test(id) ||
      !['BOLETA', 'CRONOGRAMA', 'FICHA'].includes(kind)
    )
      throw badRequest('Documento inválido');
    const { data: job, error } = await ctx.supabase
      .from('enrollment_drafts')
      .select('id,status,lease_token,data,conversation_id,review_id,student_folder_url')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (error) throw error;
    if (
      !job ||
      job.status !== 'registered' ||
      !job.lease_token ||
      request.headers.get('x-enrollment-lease') !== job.lease_token
    )
      throw new ApiError(
        'forbidden',
        'Matrícula no registrada o conexión inválida',
        403
      );
    const { data: review } = await ctx.supabase
      .from('payment_reviews')
      .select('status')
      .eq('id', job.review_id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (review?.status !== 'validated')
      throw new ApiError('forbidden', 'Pago sin validar', 403);
    if (
      request.headers.get('content-type')?.split(';')[0] !== 'application/pdf'
    )
      throw badRequest('Se requiere PDF');
    // Stream with a ceiling rather than buffering an unbounded request.
    const reader = request.body?.getReader();
    if (!reader) throw badRequest('PDF vacío');
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 10 * 1024 * 1024) {
        await reader.cancel();
        throw badRequest('PDF mayor a 10 MB');
      }
      chunks.push(value);
    }
    const buffer = Buffer.concat(chunks);
    if (
      buffer.subarray(0, 5).toString() !== '%PDF-' ||
      !buffer.subarray(-2048).includes(Buffer.from('%%EOF'))
    )
      throw badRequest('Archivo PDF inválido');
    const hash = createHash('sha256').update(buffer).digest('hex');
    const { data: prior, error: priorError } = await ctx.supabase
      .from('enrollment_document_deliveries')
      .select('status,sha256')
      .eq('enrollment_id', id)
      .eq('account_id', ctx.accountId)
      .eq('kind', kind)
      .maybeSingle();
    if (priorError) throw priorError;
    if (prior) {
      if (prior.sha256 !== hash)
        throw new ApiError(
          'bad_request',
          'El PDF cambió; requiere revisión administrativa',
          409
        );
      if (prior.status === 'sent') {
        await resumeEnrollmentAfterDocuments(ctx.supabase, ctx.accountId, id);
        return ok({ sent: true });
      }
      throw new ApiError(
        'bad_request',
        'Hay un envío anterior por revisar; no se repetirá automáticamente',
        409
      );
    }
    const { data: conversation, error: conversationError } = await ctx.supabase
      .from('conversations')
      .select('id,contact_id,user_id,automation_enabled,contact:contacts(channel)')
      .eq('id', job.conversation_id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (conversationError) throw conversationError;
    if (!conversation) throw badRequest('No se encontró la conversación de esta matrícula');
    const manualDelivery = (reason: string) => {
      const folder = typeof job.student_folder_url === 'string' &&
        job.student_folder_url.startsWith('https://drive.google.com/drive/folders/')
        ? ` Enlace de descarga: ${job.student_folder_url}`
        : ' Abre Descargar documentos en la conversación.';
      return new ApiError('bad_request', `Entrega manual: ${reason}. La matrícula se conserva; no se enviará por API.${folder}`, 409);
    };
    if (conversation?.automation_enabled === false)
      throw manualDelivery('la automatización está desactivada');
    const contact = Array.isArray(conversation?.contact)
      ? conversation.contact[0]
      : conversation?.contact;
    if (contact?.channel === 'whatsapp') {
      // Read only: the sender makes the atomic quota reservation once, at dispatch.
      // A known block must not upload to Meta or create an uncertain-send reservation.
      let billing;
      try {
        billing = await readConversationBillingPreflight(ctx.supabase, ctx.accountId, conversation.id);
      } catch {
        throw manualDelivery('no se pudo comprobar la cobertura del envío');
      }
      if (!billing.service_window_open)
        throw manualDelivery('la ventana de atención de 24 horas venció');
      if (!billing.automatic_send_allowed)
        throw manualDelivery('no hay cobertura gratuita confirmada');
    }
    const { data: config } = await ctx.supabase
      .from('whatsapp_config')
      .select('access_token,phone_number_id')
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if ((!isSocialChannel(contact?.channel) && contact?.channel !== 'whatsapp') || (contact?.channel === 'whatsapp' && !config))
      throw badRequest('No hay conexión para el canal de esta matrícula');
    if (isSocialChannel(contact?.channel)) socialConfiguration(contact.channel, ctx.accountId);
    const documentName = String(job.data.full_name)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[\\/\r\n]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase();
    const filename = `${kind}-${documentName}-${String(job.data.document_number)
      .replace(/[^a-zA-Z0-9]/g, '')
      .toUpperCase()}.pdf`;
    // Upload failures occur before the idempotent send reservation and are safe to retry.
    const uploaded: { mediaId: string; url?: string } = contact?.channel === 'whatsapp' ? await uploadMedia({
      phoneNumberId: config!.phone_number_id,
      accessToken: decrypt(config!.access_token),
      buffer,
      contentType: 'application/pdf',
      fileName: filename,
    }) : await saveSocialDocument(ctx.supabase, ctx.accountId, id, hash, buffer);
    const { error: reservedError } = await ctx.supabase
      .from('enrollment_document_deliveries')
      .insert({
        enrollment_id: id,
        account_id: ctx.accountId,
        kind,
        sha256: hash,
        media_id: uploaded.mediaId,
        filename,
        status: 'sending',
      });
    if (reservedError)
      throw new ApiError(
        'bad_request',
        'Otro envío ya tomó este documento',
        409
      );
    try {
      const sent = await engineSendMedia({
        accountId: ctx.accountId,
        userId: conversation.user_id,
        conversationId: conversation.id,
        contactId: conversation.contact_id,
        mediaType: 'document',
        mediaUrl: uploaded.url ?? uploaded.mediaId,
        filename,
      });
      const { error: savedError } = await ctx.supabase
        .from('enrollment_document_deliveries')
        .update({
          status: 'sent',
          whatsapp_message_id: sent.whatsapp_message_id,
          sent_at: new Date().toISOString(),
        })
        .eq('enrollment_id', id)
        .eq('account_id', ctx.accountId)
        .eq('kind', kind);
      if (savedError) throw savedError;
      await resumeEnrollmentAfterDocuments(ctx.supabase, ctx.accountId, id);
      return ok({ sent: true });
    } catch (sendError) {
      // A timeout may occur AFTER Meta accepted the PDF. Freeze for review to avoid duplicate sends.
      await ctx.supabase
        .from('enrollment_document_deliveries')
        .update({
          status: 'review',
          error:
            'No se pudo confirmar el envío. Revisar el chat antes de reenviar.',
        })
        .eq('enrollment_id', id)
        .eq('account_id', ctx.accountId)
        .eq('kind', kind);
      console.error('[enrollment/documents] send requires review', sendError);
      throw new ApiError(
        'bad_request',
        'No se confirmó el envío; revisa el chat antes de repetirlo',
        502
      );
    }
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
