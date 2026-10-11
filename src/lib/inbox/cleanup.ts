/** A later incoming message reopens the chat, without revealing cleared history. */
export function isVisibleInInbox(chat: {inbox_cleared_at?: string | null;last_message_at?:string | null}): boolean {
  return !chat.inbox_cleared_at || !!(chat.last_message_at && Date.parse(chat.last_message_at) > Date.parse(chat.inbox_cleared_at));
}
