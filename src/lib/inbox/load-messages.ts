import type { SupabaseClient } from '@supabase/supabase-js';
import type { Message } from '@/types';

export const RECENT_MESSAGE_LIMIT = 150;

/**
 * Fast initial Inbox load. Long sales chats can contain more than a thousand
 * messages; rendering all of them before the thread becomes usable freezes the
 * page. Fetch one extra row so the UI can offer the complete history on demand.
 */
export async function loadRecentConversationMessages(
  db: SupabaseClient,
  conversationId: string,
  cancelled: () => boolean,
): Promise<{ messages: Message[]; hasMore: boolean }> {
  const { data, error } = await db
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(0, RECENT_MESSAGE_LIMIT);
  if (error) throw error;
  if (cancelled()) return { messages: [], hasMore: false };

  const page = (data ?? []) as Message[];
  const hasMore = page.length > RECENT_MESSAGE_LIMIT;
  const recent = page.slice(0, RECENT_MESSAGE_LIMIT);
  if (!recent.length) return { messages: [], hasMore };

  const { data: hidden, error: hiddenError } = await db
    .from('inbox_hidden_messages')
    .select('message_id')
    .in('message_id', recent.map((message) => message.id));
  if (hiddenError) throw hiddenError;
  const hiddenIds = new Set((hidden ?? []).map((row) => row.message_id));
  return {
    messages: recent.filter((message) => !hiddenIds.has(message.id)).reverse(),
    hasMore,
  };
}

/** Explicit small pages avoid silently truncating long chats at the API row limit. RLS still applies. */
export async function loadConversationMessages(db: SupabaseClient, conversationId: string, cancelled: () => boolean): Promise<Message[]> {
  const messages: Message[] = [];
  const pageSize = 100;
  for (let offset = 0; !cancelled(); offset += pageSize) {
    const { data, error } = await db.from('messages').select('*').eq('conversation_id', conversationId)
      .order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + pageSize - 1);
    if (error) throw error;
    const page = (data ?? []) as Message[];
    if (page.length) {
      const { data: hidden, error: hiddenError } = await db.from('inbox_hidden_messages').select('message_id').in('message_id', page.map(m => m.id));
      if (hiddenError) throw hiddenError;
      const ids = new Set((hidden ?? []).map(row => row.message_id));
      messages.push(...page.filter(m => !ids.has(m.id)));
    }
    if (!data || data.length < pageSize) break;
  }
  return messages.reverse();
}
