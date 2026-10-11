import type { SocialChannel } from './meta-api'

type RecordValue = Record<string, unknown>
const record = (value: unknown): RecordValue => value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {}
const string = (value: unknown): string => typeof value === 'string' ? value : ''
export interface SocialInbound {
  assetId: string
  senderId: string
  messageId: string
  text: string
  replyId: string | null
  replyTo: string | null
  createdAt: string
  parts: { type: 'text' | 'image' | 'video' | 'audio' | 'document' | 'interactive'; text: string | null; url: string | null }[]
}

/** Meta may batch multiple entries/events. Echoes, delivery receipts and
 * messages for a different asset must never re-enter the sales funnel. */
export function parseSocialInbound(channel: SocialChannel, body: unknown, assetId: string): SocialInbound[] {
  const root = record(body)
  if (root.object !== (channel === 'instagram' ? 'instagram' : 'page')) return []
  const result: SocialInbound[] = []
  for (const rawEntry of Array.isArray(root.entry) ? root.entry : []) {
    const entry = record(rawEntry)
    if (string(entry.id) !== assetId) continue
    for (const rawEvent of Array.isArray(entry.messaging) ? entry.messaging : []) {
      const event = record(rawEvent), message = record(event.message), postback = record(event.postback)
      const senderId = string(record(event.sender).id), recipientId = string(record(event.recipient).id)
      if (message.is_echo || !/^\d+$/.test(senderId) || senderId === assetId || recipientId !== assetId) continue
      const messageId = string(message.mid) || string(postback.mid)
      if (!messageId) continue
      const replyId = string(record(message.quick_reply).payload) || string(postback.payload) || null
      const text = string(message.text) || string(postback.title)
      const parts: SocialInbound['parts'] = []
      for (const raw of Array.isArray(message.attachments) ? message.attachments : []) {
        const attachment = record(raw), url = string(record(attachment.payload).url)
        const type = attachment.type === 'file' ? 'document' : attachment.type
        if (!['image', 'video', 'audio', 'document'].includes(string(type)) || !url) continue
        try { if (new URL(url).protocol !== 'https:') continue } catch { continue }
        parts.push({ type: type as 'image' | 'video' | 'audio' | 'document', text: parts.length === 0 ? text || null : null, url })
      }
      if (!parts.length && (text || replyId)) parts.push({ type: replyId ? 'interactive' : 'text', text: text || null, url: null })
      if (!parts.length) continue
      const timestamp = typeof event.timestamp === 'number' ? event.timestamp : Date.now()
      const date = new Date(timestamp)
      if (!Number.isFinite(date.getTime())) continue
      result.push({ assetId, senderId, messageId, text, replyId, replyTo: string(record(message.reply_to).mid) || null, createdAt: date.toISOString(), parts })
    }
  }
  return result
}
