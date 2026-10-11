import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { isSocialChannel } from '@/lib/social/meta-api'
import { readSocialImage } from '@/lib/social/storage'

/** Authenticated image proxy: a stored document never becomes a public file. */
export async function GET(_request: Request, { params }: { params: Promise<{ messageId: string }> }) {
  const db = await createClient()
  const { data: { user } } = await db.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })
  const { messageId } = await params
  const { data: message } = await db.from('messages').select('message_id,conversation_id,content_type').eq('id', messageId).maybeSingle()
  if (!message || message.content_type !== 'image') return new Response('Not found', { status: 404 })
  const { data: conversation } = await db.from('conversations').select('account_id,contact:contacts(channel)').eq('id', message.conversation_id).maybeSingle()
  const contact = Array.isArray(conversation?.contact) ? conversation.contact[0] : conversation?.contact
  if (!conversation || !isSocialChannel(contact?.channel)) return new Response('Not found', { status: 404 })
  try {
    const media = await readSocialImage(supabaseAdmin(), contact.channel, conversation.account_id, message.conversation_id, message.message_id)
    return new Response(new Uint8Array(media.buffer), { headers: { 'Content-Type': media.contentType, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } })
  } catch { return new Response('Not found', { status: 404 }) }
}
