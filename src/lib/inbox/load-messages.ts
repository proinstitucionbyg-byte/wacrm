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
    messages.push(...(data ?? []) as Message[]);
    if (!data || data.length < pageSize) break;
  }
  return messages.reverse();
}
