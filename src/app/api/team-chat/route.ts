import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { parseTeamThread } from '@/lib/team-chat';
export async function GET() {
  try {
    const ctx = await requireRole('agent');
    const [rooms, people, notices] = await Promise.all([
      ctx.supabase
        .from('team_threads')
        .select(
          'id,kind,title,last_message_at,team_thread_members(user_id,last_read_at)'
        )
        .eq('account_id', ctx.accountId)
        .order('last_message_at', { ascending: false })
        .limit(100),
      ctx.supabase
        .from('profiles')
        .select('user_id,full_name,account_role')
        .eq('account_id', ctx.accountId)
        .in('account_role', ['owner', 'admin', 'agent']),
      ctx.supabase
        .from('notifications')
        .select('team_thread_id')
        .eq('account_id', ctx.accountId)
        .eq('user_id', ctx.userId)
        .eq('type', 'team_message')
        .is('read_at', null)
        .limit(1000),
    ]);
    for (const result of [rooms, people, notices])
      if (result.error) throw result.error;
    const counts = new Map<string, number>();
    for (const n of notices.data ?? [])
      if (n.team_thread_id)
        counts.set(n.team_thread_id, (counts.get(n.team_thread_id) ?? 0) + 1);
    return NextResponse.json({
      threads: (rooms.data ?? []).map((r) => ({
        ...r,
        unread: counts.get(r.id) ?? 0,
      })),
      members: people.data ?? [],
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const input = parseTeamThread(await request.json().catch(() => null));
    if (!input)
      return NextResponse.json(
        {
          error:
            'Selecciona participantes y, para un grupo, escribe su nombre.',
        },
        { status: 400 }
      );
    const { data, error } = await ctx.supabase.rpc('create_team_thread', {
      target_members: input.members,
      thread_title: input.title,
    });
    if (error) {
      if (error.code === '42501')
        return NextResponse.json(
          { error: 'Los participantes deben pertenecer a tu equipo.' },
          { status: 403 }
        );
      throw error;
    }
    return NextResponse.json({ id: data }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
