import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { enrollmentIssues } from '@/lib/matriculas/enrollment';

export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const reviewId = new URL(request.url).searchParams.get('review_id');
    if (reviewId && !/^[0-9a-f-]{36}$/i.test(reviewId))
      return NextResponse.json(
        { error: 'Comprobante inválido' },
        { status: 400 }
      );
    let query = ctx.supabase
      .from('enrollment_drafts')
      .select('*')
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (reviewId) query = query.eq('review_id', reviewId);
    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({
      drafts: (data ?? []).map((draft) => ({
        ...draft,
        issues: enrollmentIssues(draft.data),
      })),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
