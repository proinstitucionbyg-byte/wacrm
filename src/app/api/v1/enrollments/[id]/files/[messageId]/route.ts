import { requireApiKey } from '@/lib/auth/api-context';
import { ApiError, toApiErrorResponse } from '@/lib/api/v1/respond';
import { decrypt } from '@/lib/whatsapp/encryption';
import { downloadMedia, getMediaUrl } from '@/lib/whatsapp/meta-api';
import { declarationImage } from '@/lib/matriculas/declaration-image';
import { isSocialChannel } from '@/lib/social/meta-api';
import { readSocialImage } from '@/lib/social/storage';
import { downloadSocialMedia } from '@/lib/social/media';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; messageId: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'enrollments:sync');
    const { id, messageId } = await params;
    const { data: draft, error } = await ctx.supabase
      .from('enrollment_drafts')
      .select('review_id,conversation_id,status,data,lease_token')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (error) throw error;
    if (
      !draft ||
      draft.status !== 'processing' ||
      request.headers.get('x-enrollment-lease') !== draft.lease_token
    )
      throw new ApiError(
        'not_found',
        'Archivo no disponible para esta ejecución',
        404
      );
    const { data: review, error: reviewError } = await ctx.supabase
      .from('payment_reviews')
      .select('message_id,status')
      .eq('id', draft.review_id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (reviewError) throw reviewError;
    const identityIds = Array.isArray(draft.data?.identity_message_ids)
      ? draft.data.identity_message_ids
      : [];
    const declarationIds: string[] = draft.data?.declaration_message_ids ?? [];
    const guardianIds: string[] = draft.data?.guardian_message_ids ?? [];
    if (
      review?.status !== 'validated' ||
      (messageId !== review.message_id && !identityIds.includes(messageId) && !declarationIds.includes(messageId) && !guardianIds.includes(messageId))
    )
      throw new ApiError('not_found', 'Archivo no autorizado', 404);
    const { data: message, error: messageError } = await ctx.supabase
      .from('messages')
      .select('media_url,content_type,content_text,created_at,message_id')
      .eq('id', messageId)
      .eq('conversation_id', draft.conversation_id)
      .eq('sender_type', 'customer')
      .maybeSingle();
    if (messageError) throw messageError;
    if (declarationIds.includes(messageId) && message?.content_type === 'text' && message.content_text) {
      return declarationImage(message);
    }
    if (message?.content_type !== 'image') throw new ApiError('not_found', 'Imagen no disponible',404);
    if (!message.media_url?.startsWith('/api/whatsapp/media/')) {
      const { data: conversation } = await ctx.supabase.from('conversations').select('contact:contacts(channel)')
        .eq('id', draft.conversation_id).eq('account_id', ctx.accountId).maybeSingle();
      const contact = Array.isArray(conversation?.contact) ? conversation.contact[0] : conversation?.contact;
      if (!isSocialChannel(contact?.channel)) throw new ApiError('not_found', 'Canal de imagen no disponible', 404);
      const media = message.media_url === `/api/social/media/${messageId}`
        ? await readSocialImage(ctx.supabase, contact.channel, ctx.accountId, draft.conversation_id, message.message_id)
        : await downloadSocialMedia(message.media_url ?? '');
      const mime = media.contentType.split(';')[0].trim().toLowerCase();
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime) || media.buffer.length > 10 * 1024 * 1024)
        throw new ApiError('bad_request', 'Formato o tamaño de imagen no permitido', 400);
      return new Response(new Uint8Array(media.buffer), { headers: { 'Content-Type': mime, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
    }
    const match = /^\/api\/whatsapp\/media\/(\d+)$/.exec(
      message?.media_url ?? ''
    );
    if (!match)
      throw new ApiError(
        'not_found',
        'La imagen original no está disponible',
        404
      );
    const { data: config, error: configError } = await ctx.supabase
      .from('whatsapp_config')
      .select('access_token')
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (configError) throw configError;
    if (!config)
      throw new ApiError('not_found', 'WhatsApp no configurado', 404);
    const accessToken = decrypt(config.access_token);
    const media = await getMediaUrl({ mediaId: match[1], accessToken });
    const { buffer, contentType } = await downloadMedia({
      downloadUrl: media.url,
      accessToken,
    });
    const mime = (contentType || media.mimeType || '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    if (
      !['image/jpeg', 'image/png', 'image/webp'].includes(mime) ||
      buffer.length > 10 * 1024 * 1024
    )
      throw new ApiError(
        'bad_request',
        'Formato o tamaño de imagen no permitido',
        400
      );
    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type': mime,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
