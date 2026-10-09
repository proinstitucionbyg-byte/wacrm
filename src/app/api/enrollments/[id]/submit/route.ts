import { NextResponse } from 'next/server';
import { toErrorResponse } from '@/lib/auth/account';
import { requirePermission } from '@/lib/auth/permissions';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import {
  enrollmentIssues,
  parseEnrollmentData,
} from '@/lib/matriculas/enrollment';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requirePermission('enrollments', 'edit');
    const { id } = await params;
    const body = await request.json().catch(() => null);
    if (!Number.isSafeInteger(body?.version) || body.version < 1)
      return NextResponse.json({ error: 'Versión inválida' }, { status: 400 });
    const { data: draft, error } = await ctx.supabase
      .from('enrollment_drafts')
      .select('*')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (error) throw error;
    if (!draft)
      return NextResponse.json({ error: 'No encontrada' }, { status: 404 });
    if (!['collecting', 'error'].includes(draft.status))
      return NextResponse.json(
        { error: 'La ficha ya está en cola o registrada.' },
        { status: 409 }
      );
    const parsed = parseEnrollmentData(draft.data);
    const issues = parsed ? enrollmentIssues(parsed) : ['DATOS INVALIDOS'];
    if (issues.length)
      return NextResponse.json(
        { error: 'Completa los pendientes antes de enviar.', issues },
        { status: 400 }
      );
    const { data: review, error: reviewError } = await supabaseAdmin()
      .from('payment_reviews')
      .select('status')
      .eq('id', draft.review_id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (reviewError) throw reviewError;
    if (review?.status !== 'validated')
      return NextResponse.json(
        { error: 'El pago necesita validación humana.' },
        { status: 409 }
      );
    // Narrow server transition: browser users cannot change status, lease, or output columns directly.
    const { data: saved, error: saveError } = await supabaseAdmin()
      .from('enrollment_drafts')
      .update({
        status: 'ready',
        version: body.version + 1,
        error: null,
        updated_at: new Date().toISOString(),
        updated_by: ctx.userId,
      })
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .eq('version', body.version)
      .in('status', ['collecting', 'error'])
      .select('*')
      .maybeSingle();
    if (saveError) throw saveError;
    if (!saved)
      return NextResponse.json(
        { error: 'La ficha cambió. Actualiza antes de enviarla.' },
        { status: 409 }
      );
    return NextResponse.json({ draft: saved });
  } catch (error) {
    return toErrorResponse(error);
  }
}
