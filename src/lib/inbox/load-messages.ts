import type { SupabaseClient } from '@supabase/supabase-js';
import type { Message } from '@/types';

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
