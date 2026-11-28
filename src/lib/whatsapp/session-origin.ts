import type { Message } from '@/types';

/** Match the server's latest-customer-message routing; an old session message
 * must never exempt a subsequent Cloud API message from its restrictions. */
export function latestSessionOrigin(messages: Pick<Message, 'id' | 'sender_type' | 'created_at' | 'whatsapp_session_line_key'>[],supportLine?:string|null): string | null {
  const latest=messages.filter(row=>row.sender_type==='customer').reduce<(typeof messages)[number] | null>((last,row)=>{
    if(!last)return row;
    const delta=Date.parse(row.created_at)-Date.parse(last.created_at);
    return delta>0||(delta===0&&row.id>last.id)?row:last;
  },null);
  const linked=messages.filter(row=>row.whatsapp_session_line_key).reduce<(typeof messages)[number]|null>((last,row)=>!last||Date.parse(row.created_at)>Date.parse(last.created_at)||(row.created_at===last.created_at&&row.id>last.id)?row:last,null);
  if(linked&&(!latest||Date.parse(linked.created_at)>Date.parse(latest.created_at)||(linked.created_at===latest.created_at&&linked.id>=latest.id)))return linked.whatsapp_session_line_key??null;
  return latest?.whatsapp_session_line_key ?? supportLine ?? null;
}
