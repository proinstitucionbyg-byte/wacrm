import { requireApiKey } from '@/lib/auth/api-context';
import { okList, toApiErrorResponse } from '@/lib/api/v1/respond';
import { buildPage, keysetFilter, parseListParams } from '@/lib/api/v1/pagination';
import { ENROLLMENT_FIELDS, parseEnrollmentData } from '@/lib/matriculas/enrollment';

interface SheetDraft {
  id: string;
  review_id: string;
  created_at: string;
  status: string;
  data: unknown;
  sales_adviser: string | null;
  registered_number: string | null;
  student_folder_url: string | null;
  review: { status: string; payment_purpose: string; operation_reference: string | null };
}

/** A paid intake must appear in the sheet before identity/document processing is complete. */
export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'enrollments:sync');
    const { limit, cursor } = parseListParams(request);
    let query = ctx.supabase.from('enrollment_drafts')
      .select('id,review_id,created_at,status,data,sales_adviser,registered_number,student_folder_url,review:payment_reviews!inner(account_id,status,payment_purpose,operation_reference)')
      .eq('account_id', ctx.accountId)
      .eq('review.account_id', ctx.accountId)
      .eq('review.status', 'validated')
      .in('review.payment_purpose', ['enrollment', 'unclassified'])
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);
    const filter = keysetFilter(cursor);
    if (filter) query = query.or(filter);
    const { data, error } = await query;
    if (error) throw error;
    const { items, nextCursor } = buildPage((data ?? []) as unknown as SheetDraft[], limit);
    return okList(items.flatMap((row) => {
      const input = row.data && typeof row.data === 'object' ? row.data as Record<string, unknown> : {};
      // Evidence/prices may still need review. They must not hide the paid
      // student's row; this snapshot only needs the known text fields.
      const fields = Object.fromEntries(Object.keys(ENROLLMENT_FIELDS).map((field) =>
        [field, typeof input[field] === 'string' ? input[field].slice(0, 500) : '']));
      const clean = parseEnrollmentData(fields) ?? {};
      const phone = clean?.phone1?.replace(/\D/g, '').replace(/^51(?=\d{9}$)/, '');
      // The owner explicitly excluded this test number. Legacy unclassified
      // payments are included only when their enrollment was already completed.
      if (phone === '987020644' || row.review.status !== 'validated'
        || (row.review.payment_purpose !== 'enrollment'
          && !(row.review.payment_purpose === 'unclassified' && row.status === 'registered'))) return [];
      return [{
        id: row.id, review_id: row.review_id, created_at: row.created_at,
        status: row.status, data: clean, sales_adviser: row.sales_adviser,
        registered_number: row.registered_number, student_folder_url: row.student_folder_url,
        payment_status: row.review.status, payment_purpose: row.review.payment_purpose,
        operation_reference: row.review.operation_reference,
      }];
    }), nextCursor);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
