import { NextResponse } from 'next/server';
import { toErrorResponse } from '@/lib/auth/account';
import { requirePermission, canInAccount } from '@/lib/auth/permissions';
import { enrollmentIssues } from '@/lib/matriculas/enrollment';
import {supabaseAdmin} from '@/lib/flows/admin-client';

export async function GET(request: Request) {
  try {
    const ctx = await requirePermission('enrollments', 'view');
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
    const {data:reviews,error:reviewsError}=data?.length?await supabaseAdmin().from('payment_reviews').select('id,status,payment_purpose').eq('account_id',ctx.accountId).in('id',data.map(draft=>draft.review_id)):{data:[],error:null};
    if(reviewsError)throw reviewsError;
    const reviewStates=new Map((reviews??[]).map(review=>[review.id,review]));
    return NextResponse.json({
      canEdit: await canInAccount(ctx, 'enrollments', 'edit'),
      drafts: (data ?? []).filter(draft=>!['tuition','other'].includes(reviewStates.get(draft.review_id)?.payment_purpose??'')).map((draft) => ({
        ...draft,
        payment_status:reviewStates.get(draft.review_id)?.status,
        issues: enrollmentIssues(draft.data),
      })),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
