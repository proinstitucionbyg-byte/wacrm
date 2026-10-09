import { requireApiKey } from '@/lib/auth/api-context';
import {
  ApiError,
  badRequest,
  ok,
  toApiErrorResponse,
} from '@/lib/api/v1/respond';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'enrollments:sync');
    const { id } = await params;
    const body = await request.json().catch(() => null);
    if (
      typeof body?.lease_token !== 'string' ||
      !['registered', 'error'].includes(body?.status)
    )
      throw badRequest('Resultado inválido');
    if (
      body.status === 'registered' &&
      (!/^\d+$/.test(String(body.registered_number ?? '')) ||
        !/^https:\/\/drive\.google\.com\/drive\/folders\/[\w-]+$/.test(
          body.student_folder_url ?? ''
        ))
    )
      throw badRequest('Número o carpeta inválidos');
    if (
      body.status === 'error' &&
      (typeof body.error !== 'string' ||
        !body.error.trim() ||
        body.error.length > 1000)
    )
      throw badRequest('Falta observación del error');
    const { data: existing, error: readError } = await ctx.supabase
      .from('enrollment_drafts')
      .select('status,lease_token,registered_number,student_folder_url')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (readError) throw readError;
    if (!existing)
      throw new ApiError('not_found', 'Matrícula no encontrada', 404);
    if (existing.lease_token !== body.lease_token)
      throw new ApiError(
        'bad_request',
        'Otra ejecución tiene esta matrícula',
        409
      );
    if (
      existing.status === 'registered' &&
      body.status === 'registered' &&
      existing.registered_number === String(body.registered_number) &&
      existing.student_folder_url === body.student_folder_url
    )
      return ok({ registered: true });
    if (existing.status !== 'processing')
      throw new ApiError(
        'bad_request',
        'La matrícula ya no está en proceso',
        409
      );
    const output =
      body.status === 'registered'
        ? {
            status: 'registered',
            registered_number: String(body.registered_number),
            student_folder_url: body.student_folder_url,
            error: null,
          }
        : { status: 'error', error: body.error.trim() };
    const { data: saved, error } = await ctx.supabase
      .from('enrollment_drafts')
      .update({
        ...output,
        lease_until: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .eq('status', 'processing')
      .eq('lease_token', body.lease_token)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (!saved) throw new ApiError('bad_request', 'La ejecución cambió', 409);
    // Registration is not proof of PDF generation or WhatsApp delivery.
    return ok({ registered: body.status === 'registered' });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
