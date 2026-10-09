import { NextResponse } from 'next/server';
import { toErrorResponse } from '@/lib/auth/account';
import { requirePermission, canInAccount } from '@/lib/auth/permissions';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { parsePaymentDecision } from '@/lib/payments/review';
import { collectConversationEnrollments } from '@/lib/matriculas/collect';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission('payments', 'review');
    if (!await canInAccount(ctx, 'payments', 'view')) return NextResponse.json({ error: 'Necesitas permiso para ver los pagos.' }, { status: 403 });
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Caso inválido' }, { status: 400 });
    let raw;
    try { raw = await request.json(); } catch { return NextResponse.json({ error: 'Solicitud inválida' }, { status: 400 }); }
    const decision = parsePaymentDecision(raw);
    if (!decision) return NextResponse.json({ error: 'Elige una decisión. Para rechazo u observación, escribe el motivo.' }, { status: 400 });
    const { data, error } = await ctx.supabase.from('payment_reviews')
      .update({ status: decision.status, note: decision.note })
      .eq('id', id).eq('account_id', ctx.accountId).eq('version', decision.version)
      .neq('status', 'validated').select('id,status,version,reviewed_at,reviewed_by,conversation_id').maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: 'El caso cambió o ya está validado. Actualiza antes de decidir.' }, { status: 409 });
    if (data.status === 'validated' && data.conversation_id) {
      try { await collectConversationEnrollments(supabaseAdmin(), ctx.accountId, data.conversation_id); }
      catch (error) { console.error('[matriculas] payment intake collection failed:', error); }
    }
    return NextResponse.json({ review: data });
  } catch (error) { return toErrorResponse(error); }
}
