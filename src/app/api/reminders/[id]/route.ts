import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getCurrentAccount();
    const { id } = await params;
    const { data, error } = await ctx.supabase.from('adviser_reminders').delete()
      .eq('id', id).eq('account_id', ctx.accountId).eq('user_id', ctx.userId).select('id').maybeSingle();
    if (error) throw error;
    return data ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'Recordatorio no encontrado.' }, { status: 404 });
  } catch (error) { return toErrorResponse(error); }
}
