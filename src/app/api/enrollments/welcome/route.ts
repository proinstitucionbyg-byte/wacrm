import { NextResponse } from 'next/server';
import { canInAccount, requirePermission } from '@/lib/auth/permissions';
import { toErrorResponse } from '@/lib/auth/account';
import { UUID_PATTERN } from '@/lib/team-chat';
import { enrollmentIssues, type EnrollmentData } from '@/lib/matriculas/enrollment';
export async function GET(request: Request) {
  try {
    const ctx = await requirePermission('inbox', 'view');
    const conversation = new URL(request.url).searchParams.get('conversation');
    if (!UUID_PATTERN.test(conversation ?? ''))
      return NextResponse.json({ error: 'Chat invalido' }, { status: 400 });
    const { data, error } = await ctx.supabase
      .from('enrollment_sequence_runs')
      .select(
        'id,stage,welcome_due_at,completed_at,completed_by,backup_sent_at,status'
      )
      .eq('account_id', ctx.accountId)
      .eq('conversation_id', conversation)
      .in('stage', ['final', 'provisional'])
      .neq('status', 'closed')
      .order('started_at', { ascending: false })
      .limit(1);
    if (error) throw error;
    const { data: draft, error: draftError } = await ctx.supabase
      .from('enrollment_drafts')
      .select('id,version,data,status,review_id')
      .eq('account_id', ctx.accountId)
      .eq('conversation_id', conversation)
      .eq('status', 'collecting')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (draftError) throw draftError;
    let intake = null;
    if (draft) {
      const { data: review, error: reviewError } = await ctx.supabase
        .from('payment_reviews')
        .select('status,payment_purpose')
        .eq('id', draft.review_id)
        .eq('account_id', ctx.accountId)
        .maybeSingle();
      if (reviewError) throw reviewError;
      if (review?.status === 'validated' && review.payment_purpose === 'enrollment'
          && await canInAccount(ctx, 'enrollments', 'edit')) {
        intake = {
          id: draft.id,
          version: draft.version,
          data: draft.data as EnrollmentData,
          issues: enrollmentIssues(draft.data as EnrollmentData),
          can_edit: await canInAccount(ctx, 'enrollments', 'edit'),
        };
      }
    }
    return NextResponse.json({ tasks: data ?? [], intake });
  } catch (error) {
    return toErrorResponse(error);
  }
}
export async function POST(request: Request) {
  try {
    const ctx = await requirePermission('inbox', 'send');
    const body = await request.json().catch(() => null);
    if (!UUID_PATTERN.test(body?.id ?? ''))
      return NextResponse.json(
        { error: 'Bienvenida invalida' },
        { status: 400 }
      );
    const { data, error } = await ctx.supabase.rpc(
      'complete_enrollment_welcome',
      { p_id: body.id }
    );
    if (error)
      return NextResponse.json(
        {
          error:
            'No puedes marcar esta bienvenida o ya vencieron las dos horas.',
        },
        { status: 403 }
      );
    return NextResponse.json(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
