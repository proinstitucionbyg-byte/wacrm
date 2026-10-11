import type { SupabaseClient } from '@supabase/supabase-js'
import { isSocialChannel, socialConfiguration, socialMessageParts, sendSocialPart, type SocialMessageInput } from './meta-api'

export interface SocialSendInput extends SocialMessageInput {
  accountId: string
  conversationId: string
  contactId: string
  channel: string
  externalId: string | null
  senderId?: string
  aiGenerated?: boolean
  transcript?: string
}

/** Shared by manual sends, AI, flows and saved automation blocks. The caller
 * supplies its own client: agent inserts retain RLS and the lease trigger. */
export async function sendSocialMessage(db: SupabaseClient, input: SocialSendInput): Promise<{ whatsapp_message_id: string; message_id: string }> {
  if (!isSocialChannel(input.channel) || !input.externalId) throw new Error('Canal o destinatario social no disponible.')
  const config = socialConfiguration(input.channel, input.accountId)
  const { data: conversation, error } = await db.from('conversations').select('id')
    .eq('id', input.conversationId).eq('account_id', input.accountId).eq('contact_id', input.contactId).maybeSingle()
  if (error || !conversation) throw new Error('No puedes enviar a esta conversación.')
  const parts = socialMessageParts(input.channel, input)
  let metaId = '', internalId = ''
  for (const part of parts) {
    metaId = await sendSocialPart(input.channel, config, input.externalId, part)
    const { data: saved, error: saveError } = await db.from('messages').insert({
      conversation_id: input.conversationId,
      sender_type: input.senderId ? 'agent' : 'bot',
      ...(input.senderId ? { sender_id: input.senderId } : {}),
      content_type: part.contentType,
      content_text: part.contentText ?? (part.contentType === 'audio' ? input.transcript ?? null : null),
      media_url: part.mediaUrl ?? null,
      interactive_payload: part.interactivePayload ?? null,
      message_id: metaId, status: 'sent', ai_generated: input.aiGenerated ?? false,
    }).select('id').single()
    if (saveError || !saved) throw new Error('Meta recibió el mensaje, pero no se guardó su confirmación. Revisa el chat antes de repetirlo.')
    internalId = saved.id
    const now = new Date().toISOString()
    const { error: updateError } = await db.from('conversations').update({
      last_message_text: part.contentText || `[${part.contentType}]`, last_message_at: now, updated_at: now,
    }).eq('id', input.conversationId).eq('account_id', input.accountId)
    if (updateError) throw new Error('Mensaje enviado; no se actualizó la vista del chat. Revisa antes de repetirlo.')
  }
  // Legacy property retained for the existing flow/enrollment engines.
  return { whatsapp_message_id: metaId, message_id: internalId }
}
