import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { UUID_PATTERN } from '@/lib/team-chat';
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await params;
    const body = await request.json().catch(() => null);
    if (
      !UUID_PATTERN.test(id) ||
      typeof body?.through !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(body.through) ||
      !Number.isFinite(Date.parse(body.through)) ||
      Date.parse(body.through) > Date.now()
    )
      return NextResponse.json(
        { error: 'Fecha de lectura inválida' },
        { status: 400 }
      );
    const { data: member, error } = await ctx.supabase
      .from('team_thread_members')
      .update({ last_read_at: body.through })
      .eq('thread_id', id)
      .eq('account_id', ctx.accountId)
      .eq('user_id', ctx.userId)
      .select('thread_id')
      .maybeSingle();
    if (error) throw error;
    if (!member)
      return NextResponse.json(
        { error: 'Chat no disponible' },
        { status: 404 }
      );
    const { error: notificationError } = await ctx.supabase
      .from('notifications')
      .update({ read_at: body.through })
      .eq('account_id', ctx.accountId)
      .eq('user_id', ctx.userId)
      .eq('team_thread_id', id)
      .is('read_at', null)
      .lte('created_at', body.through);
    if (notificationError) throw notificationError;
    return NextResponse.json({ read: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
