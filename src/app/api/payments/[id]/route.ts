import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { parsePaymentDecision } from '@/lib/payments/review';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('owner');
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Caso inválido' }, { status: 400 });
    let raw;
    try { raw = await request.json(); } catch { return NextResponse.json({ error: 'Solicitud inválida' }, { status: 400 }); }
    const decision = parsePaymentDecision(raw);
    if (!decision) return NextResponse.json({ error: 'Elige una decisión. Para rechazo u observación, escribe el motivo.' }, { status: 400 });
    const { data, error } = await ctx.supabase.from('payment_reviews')
      .update({ status: decision.status, note: decision.note })
      .eq('id', id).eq('account_id', ctx.accountId).eq('version', decision.version)
      .neq('status', 'validated').select('id,status,version,reviewed_at,reviewed_by').maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: 'El caso cambió o ya está validado. Actualiza antes de decidir.' }, { status: 409 });
    return NextResponse.json({ review: data });
  } catch (error) { return toErrorResponse(error); }
}
