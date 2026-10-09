import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { isPaymentStatus } from '@/lib/payments/review';

export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const params = new URL(request.url).searchParams;
    const messageId = params.get('message_id');
    const status = params.get('status') ?? 'pending';
    const offset = Number(params.get('offset') ?? 0);
    if ((!isPaymentStatus(status) && status !== 'all') || !Number.isSafeInteger(offset) || offset < 0 || offset > 100000) return NextResponse.json({ error: 'Filtro inválido' }, { status: 400 });
    if (messageId && !/^[0-9a-f-]{36}$/i.test(messageId)) return NextResponse.json({ error: 'Mensaje inválido' }, { status: 400 });
    let query = ctx.supabase.from('payment_reviews').select('*, contact:contacts(name,phone)', { count: 'exact' }).eq('account_id', ctx.accountId).order('created_at', { ascending: false });
    if (messageId) query = query.eq('message_id', messageId);
    else if (status !== 'all') query = query.eq('status', status);
    const { data, error, count } = await query.range(offset, offset + 49);
    if (error) throw error;
    return NextResponse.json({ reviews: data ?? [], total: count ?? 0, canReview: ctx.role === 'owner' });
  } catch (error) { return toErrorResponse(error); }
}

// Human referral: permits an adviser to send an unreadable image for review.
// The database RPC checks membership/account and can ONLY create pending cases.
export async function POST(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    let body;
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Solicitud inválida' }, { status: 400 }); }
    if (typeof body?.message_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.message_id)) return NextResponse.json({ error: 'Mensaje inválido' }, { status: 400 });
    const { data, error } = await ctx.supabase.rpc('refer_payment_for_review', { target_message: body.message_id });
    if (error) return NextResponse.json({ error: 'No se pudo derivar el comprobante. Verifica tus permisos y que sea una imagen recibida.' }, { status: 403 });
    return NextResponse.json({ id: data });
  } catch (error) { return toErrorResponse(error); }
}
