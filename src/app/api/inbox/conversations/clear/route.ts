import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { toErrorResponse } from '@/lib/auth/account';
import { UUID_PATTERN } from '@/lib/team-chat';

export async function POST(request: Request) {
  try {
    const ctx = await requirePermission('inbox_management', 'conversations');
    const body = await request.json().catch(() => null);
    if (body?.confirmed !== true || !Array.isArray(body?.conversations) ||
      !body.conversations.length || body.conversations.length > 100 ||
      body.conversations.some((id: unknown) => typeof id !== 'string' || !UUID_PATTERN.test(id))) {
      return NextResponse.json({ error: 'Confirma entre 1 y 100 conversaciones.' }, { status: 400 });
    }
    const ids = [...new Set<string>(body.conversations)];
    const { data, error } = await ctx.supabase.from('conversations').select('id')
      .eq('account_id', ctx.accountId).in('id', ids);
    if (error) throw error;
    if (data?.length !== ids.length) return NextResponse.json({ error: 'No tienes acceso a toda la selección.' }, { status: 403 });
    const cleared: string[] = [], failed: string[] = [];
    for (const id of ids) {
      const result = await ctx.supabase.rpc('set_inbox_cleared', { p_conversation: id, p_clear: true });
      if (result.error) failed.push(id); else cleared.push(id);
    }
    return NextResponse.json({ cleared, failed, scope: 'team_inbox', recoverable: true }, {
      status: failed.length ? 207 : 200, headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) { return toErrorResponse(error); }
}
