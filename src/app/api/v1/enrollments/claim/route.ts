import { randomUUID } from 'node:crypto';
import { requireApiKey } from '@/lib/auth/api-context';
import { ok, toApiErrorResponse } from '@/lib/api/v1/respond';
import {
  enrollmentIssues, parseEnrollmentData,
} from '@/lib/matriculas/enrollment';

/** Google claims at most one job. Version CAS prevents concurrent workers processing the same lease. */
export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'enrollments:sync');
    const now = new Date().toISOString();
    const { data: candidates, error } = await ctx.supabase
      .from('enrollment_drafts')
      .select('id,review_id,version,status,data,sales_adviser')
      .eq('account_id', ctx.accountId)
      .not('sales_adviser', 'is', null)
      .or(`status.eq.ready,and(status.eq.processing,lease_until.lt.${now})`)
      .order('created_at', { ascending: true })
      .limit(5);
    if (error) throw error;
    for (const row of candidates ?? []) {
      // Older receipts lack a reliable snapshot; do not invent sales credit.
      if (!row.sales_adviser?.trim()) continue;
      const cleanData = parseEnrollmentData(row.data);
      if (!cleanData || enrollmentIssues(cleanData).length) continue;
      const { data: review, error: reviewError } = await ctx.supabase
        .from('payment_reviews')
        .select('status,message_id')
        .eq('id', row.review_id)
        .eq('account_id', ctx.accountId)
        .maybeSingle();
      if (reviewError) throw reviewError;
      if (review?.status !== 'validated') continue;
      const lease = randomUUID();
      const { data: claimed, error: claimError } = await ctx.supabase
        .from('enrollment_drafts')
        .update({
          status: 'processing',
          lease_token: lease,
          lease_until: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
          version: row.version + 1,
          updated_at: now,
        })
        .eq('id', row.id)
        .eq('account_id', ctx.accountId)
        .eq('version', row.version)
        .eq('status', row.status)
        .select(
          'id,review_id,conversation_id,data,lease_token,version,created_at,sales_adviser'
        )
        .maybeSingle();
      if (claimError) throw claimError;
      if (claimed)
        return ok({
          job: { ...claimed, data: cleanData, voucher_message_id: review.message_id },
        });
    }
    return ok({ job: null });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
