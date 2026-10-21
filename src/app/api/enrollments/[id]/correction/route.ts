import { NextResponse } from 'next/server';
import { toErrorResponse } from '@/lib/auth/account';
import { requirePermission } from '@/lib/auth/permissions';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { UUID_PATTERN } from '@/lib/team-chat';

const validPrices = (value: unknown): value is number[] =>
  Array.isArray(value) &&
  value.length === 6 &&
  value.every(
    (price) => typeof price === 'number' && Number.isFinite(price) && price > 0
  );

/** Corrects a proven pricing error without reopening a registered enrollment. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requirePermission('enrollments', 'edit');
    const { id } = await params;
    const body = await request.json().catch(() => null);
    if (
      !UUID_PATTERN.test(id) ||
      typeof body?.expected_promotion !== 'string' ||
      typeof body?.corrected_promotion !== 'string' ||
      typeof body?.reason !== 'string' ||
      body.reason.trim().length < 10 ||
      !validPrices(body?.corrected_prices)
    )
      return NextResponse.json({ error: 'Corrección inválida' }, { status: 400 });

    const { data, error } = await supabaseAdmin().rpc(
      'correct_registered_enrollment_offer',
      {
        p_enrollment_id: id,
        p_account_id: ctx.accountId,
        p_expected_promotion: body.expected_promotion.trim(),
        p_corrected_promotion: body.corrected_promotion.trim(),
        p_corrected_prices: body.corrected_prices,
        p_reason: body.reason.trim(),
        p_actor: ctx.userId,
      }
    );
    if (error) throw error;
    return NextResponse.json({ correction: data });
  } catch (error) {
    return toErrorResponse(error);
  }
}
