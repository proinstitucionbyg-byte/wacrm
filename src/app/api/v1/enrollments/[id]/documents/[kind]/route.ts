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
import { startEnrollmentSequence } from '@/lib/matriculas/sequence';

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
      .select('id,status,lease_token,data,conversation_id,review_id')
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
        try { await startEnrollmentSequence(ctx.supabase,ctx.accountId,id,'final'); } catch(error){console.error('[matriculas] final sequence needs review',error);}
        return ok({ sent: true });
      }
      throw new ApiError(
        'bad_request',
        'Hay un envío anterior por revisar; no se repetirá automáticamente',
        409
      );
    }
    const { data: conversation } = await ctx.supabase
      .from('conversations')
      .select('id,contact_id,user_id,contact:contacts(channel)')
      .eq('id', job.conversation_id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    const { data: config } = await ctx.supabase
      .from('whatsapp_config')
      .select('access_token,phone_number_id')
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    const contact = Array.isArray(conversation?.contact)
      ? conversation.contact[0]
      : conversation?.contact;
    if (!conversation || contact?.channel !== 'whatsapp' || !config)
      throw badRequest('No hay conexión WhatsApp para esta matrícula');
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
    const uploaded = await uploadMedia({
      phoneNumberId: config.phone_number_id,
      accessToken: decrypt(config.access_token),
      buffer,
      contentType: 'application/pdf',
      fileName: filename,
    });
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
        mediaUrl: uploaded.mediaId,
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
      try { await startEnrollmentSequence(ctx.supabase,ctx.accountId,id,'final'); } catch(error){console.error('[matriculas] final sequence needs review',error);}
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
