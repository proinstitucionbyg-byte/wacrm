import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { toErrorResponse } from '@/lib/auth/account';
import { CONVERSATION_SELECT, normalizeConversations } from '@/lib/inbox/conversations';

export async function GET(request: Request) {
  try {
    const ctx = await requirePermission('inbox', 'view');
    const params = new URL(request.url).searchParams;
    const query = (params.get('q') ?? '').trim(), unread = params.get('unread') === '1';
    const offset = Number(params.get('offset') ?? 0);
    if (query.length > 120 || (!unread && query.length < 2) || !Number.isSafeInteger(offset) || offset < 0) {
      return NextResponse.json({ error: 'Escribe entre 2 y 120 caracteres.' }, { status: 400 });
    }
    const { data: matches, error } = await ctx.supabase.rpc('search_inbox_conversations', {
      p_query: query, p_unread: unread, p_offset: offset,
    });
    if (error) throw error;
    const ids: string[] = (matches ?? []).slice(0,100).map((row: { conversation_id: string }) => row.conversation_id);
    const conversations = [];
    // Keep URLs below proxy limits, and always hydrate through the caller's RLS.
    for (let start = 0; start < ids.length; start += 40) {
      const result = await ctx.supabase.from('conversations').select(CONVERSATION_SELECT)
        .eq('account_id', ctx.accountId).in('id', ids.slice(start,start+40));
      if (result.error) throw result.error;
      conversations.push(...normalizeConversations(result.data ?? []));
    }
    return NextResponse.json({ conversations, hasMore: (matches ?? []).length > 100, nextOffset: offset + 100 },
      { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return toErrorResponse(error); }
}
