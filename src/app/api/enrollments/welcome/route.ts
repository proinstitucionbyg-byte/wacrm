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
      .select('id,version,data,status,review_id,conversation_id')
      .eq('account_id', ctx.accountId)
      .eq('conversation_id', conversation)
      .eq('status', 'collecting')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (draftError) throw draftError;
    let intake = null;
    let identityCandidates: Array<{
      id: string;
      created_at: string;
      category: string | null;
      fields: Record<string, unknown>;
    }> = [];
    let declarationCandidates: Array<{ id: string; created_at: string; content_text: string }> = [];
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
        if (draft.conversation_id) {
          const { data: images, error: imagesError } = await ctx.supabase
            .from('messages')
            .select('id,created_at,image_analysis')
            .eq('conversation_id', draft.conversation_id)
            .eq('sender_type', 'customer')
            .eq('content_type', 'image')
            .order('created_at', { ascending: false })
            .limit(30);
          if (imagesError) throw imagesError;
          identityCandidates = (images ?? [])
            .filter((image) => image.image_analysis?.category === 'identity_document')
            .slice(0, 4)
            .map((image) => ({
              id: image.id,
              created_at: image.created_at,
              category: image.image_analysis?.category ?? null,
              fields: image.image_analysis?.fields ?? {},
            }));
          const { data: written, error: writtenError } = await ctx.supabase
            .from('messages')
            .select('id,created_at,content_text')
            .eq('conversation_id', draft.conversation_id)
            .eq('sender_type', 'customer')
            .eq('content_type', 'text')
            .not('content_text', 'is', null)
            .order('created_at', { ascending: false })
            .limit(40);
          if (writtenError) throw writtenError;
          declarationCandidates = (written ?? [])
            .filter((message) => typeof message.content_text === 'string' && message.content_text.trim())
            .slice(0, 40)
            .map((message) => ({ id: message.id, created_at: message.created_at, content_text: message.content_text! }));
        }
        intake = {
          id: draft.id,
          version: draft.version,
          data: draft.data as EnrollmentData,
          issues: enrollmentIssues(draft.data as EnrollmentData),
          can_edit: await canInAccount(ctx, 'enrollments', 'edit'),
          identity_candidates: identityCandidates,
          declaration_candidates: declarationCandidates,
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
