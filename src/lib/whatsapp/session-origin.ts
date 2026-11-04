import type { Message } from '@/types';

/** Match the server's latest-customer-message routing; an old session message
 * must never exempt a subsequent Cloud API message from its restrictions. */
export function latestSessionOrigin(messages: Pick<Message, 'id' | 'sender_type' | 'created_at' | 'whatsapp_session_line_key'>[]): string | null {
  const latest=messages.filter(row=>row.sender_type==='customer').reduce<(typeof messages)[number] | null>((last,row)=>{
    if(!last)return row;
    const delta=Date.parse(row.created_at)-Date.parse(last.created_at);
    return delta>0||(delta===0&&row.id>last.id)?row:last;
  },null);
  return latest?.whatsapp_session_line_key ?? null;
}
