import type { SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import type { SocialChannel } from './meta-api'
import type { SocialInbound } from './inbound'
import { downloadSocialMedia } from './media'
import { analyzeInboundImage, type ImageAnalysis } from '@/lib/ai/analyze-image'
import { transcribeSavedAudio } from '@/lib/ai/transcribe'
import { logAiUsage } from '@/lib/ai/usage'
import { collectConversationEnrollments } from '@/lib/matriculas/collect'
import { startEnrollmentSequence } from '@/lib/matriculas/sequence'
import { dispatchInboundToFlows } from '@/lib/flows/engine'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply'
import { routeInboundSales } from '@/lib/ai/sales-routing'
import { handleIdleFollowupReply } from '@/lib/ai/followup'
import type { AutomationTriggerType } from '@/types'
import { saveSocialImage } from './storage'
import { handleTeacherInbound } from '@/lib/matriculas/teachers'

export interface SocialDispatchContext {
  accountId: string; userId: string; contactId: string; conversationId: string
  messageId: string; text: string; replyId: string | null
  isFirstInboundMessage: boolean; wasCreated: boolean; hasImageEvidence: boolean
}

/** Store all attachments before replying. OCR is evidence, never payment approval. */
export async function storeSocialInbound(db: SupabaseClient, channel: SocialChannel, account: { id: string; owner_user_id: string }, inbound: SocialInbound): Promise<SocialDispatchContext | null> {
  let { data: contact, error } = await db.from('contacts').select('id,phone,external_id')
    .eq('account_id', account.id).eq('channel', channel).eq('external_id', inbound.senderId).maybeSingle()
  if (error) throw error
  const wasCreated = !contact
  if (!contact) {
    const created = await db.from('contacts').insert({
      account_id: account.id, user_id: account.owner_user_id, phone: '',
      name: `${channel === 'instagram' ? 'Instagram' : 'Messenger'} ${inbound.senderId}`,
      channel, external_id: inbound.senderId,
    }).select('id,phone,external_id').single()
    if (created.error || !created.data) throw created.error ?? new Error('No se creó el contacto social.')
    contact = created.data
  } else if (contact.phone === inbound.senderId) {
    // Older webhooks copied the scoped ID into phone. It is not a telephone.
    const cleared = await db.from('contacts').update({ phone: '' }).eq('id', contact.id).eq('account_id', account.id).eq('phone', inbound.senderId)
    if (cleared.error) throw cleared.error
  }
  let { data: conversation, error: conversationError } = await db.from('conversations')
    .select('id').eq('account_id', account.id).eq('contact_id', contact.id).maybeSingle()
  if (conversationError) throw conversationError
  if (!conversation) {
    const created = await db.from('conversations').insert({ account_id: account.id, user_id: account.owner_user_id, contact_id: contact.id }).select('id').single()
    if (created.error || !created.data) throw created.error ?? new Error('No se creó la conversación social.')
    conversation = created.data
  }
  const prior = await db.from('messages').select('id').eq('conversation_id', conversation.id).eq('message_id', inbound.messageId).maybeSingle()
  if (prior.error) throw prior.error
  if (prior.data) return null
  const { count, error: countError } = await db.from('messages').select('id', { count: 'exact', head: true }).eq('conversation_id', conversation.id).eq('sender_type', 'customer')
  if (countError) throw countError
  let replyToId: string | null = null
  if (inbound.replyTo) {
    const parent = await db.from('messages').select('id').eq('conversation_id', conversation.id).eq('message_id', inbound.replyTo).maybeSingle()
    if (parent.error) throw parent.error
    replyToId = parent.data?.id ?? null
  }
  let hasImageEvidence = false, dispatchText = inbound.text
  for (const [index, part] of inbound.parts.entries()) {
    const metaId = index === 0 ? inbound.messageId : `${inbound.messageId}:attachment:${index}`
    const internalId = randomUUID()
    let mediaUrl = part.url
    let imageAnalysis: ImageAnalysis | null = null, text = part.text
    if (part.type === 'image' && part.url) {
      try {
        const media = await downloadSocialMedia(part.url)
        await saveSocialImage(db, channel, account.id, conversation.id, metaId, media)
        mediaUrl = `/api/social/media/${internalId}`
        const result = await analyzeInboundImage({ db, accountId: account.id, media })
        imageAnalysis = result.analysis
        await logAiUsage(db, { accountId: account.id, conversationId: conversation.id, mode: 'image_analysis', provider: result.provider ?? 'openai', model: result.model ?? 'unknown', usage: result.usage })
      } catch { imageAnalysis = { status: 'failed', failure_reason: 'provider_error' } }
      hasImageEvidence = true
    }
    if (part.type === 'audio' && part.url) {
      const transcript = await transcribeSavedAudio({ db, accountId: account.id, url: part.url })
      text = transcript ? `🎤 ${transcript}` : '🎤 [Audio que no se pudo entender]'
      if (transcript) dispatchText = [dispatchText, transcript].filter(Boolean).join('\n')
    }
    const inserted = await db.from('messages').insert({
      id: internalId, conversation_id: conversation.id, sender_type: 'customer', content_type: part.type,
      content_text: text, media_url: mediaUrl, message_id: metaId, status: 'delivered',
      created_at: inbound.createdAt, interactive_reply_id: index === 0 ? inbound.replyId : null,
      reply_to_message_id: replyToId, image_analysis: imageAnalysis,
    }).select('id').single()
    if (inserted.error || !inserted.data) throw inserted.error ?? new Error('No se guardó el mensaje social.')
    if (imageAnalysis?.category === 'payment_receipt') {
      const review = await db.from('payment_reviews').select('id').eq('account_id', account.id).eq('message_id', inserted.data.id).maybeSingle()
      if (review.error) throw review.error
      if (review.data) {
        await db.from('payment_reviews').update({ origin: channel.toUpperCase() }).eq('id', review.data.id).eq('account_id', account.id)
        try { await startEnrollmentSequence(db, account.id, review.data.id, 'receipt') }
        catch (error) { console.error('[social] payment continuation needs review', error) }
      }
    }
  }
  const now = new Date().toISOString()
  const updated = await db.from('conversations').update({ last_message_text: dispatchText || `[${inbound.parts[0].type}]`, last_message_at: now, updated_at: now })
    .eq('id', conversation.id).eq('account_id', account.id)
  if (updated.error) throw updated.error
  try { await collectConversationEnrollments(db, account.id, conversation.id) }
  catch (error) { console.error('[social] enrollment data needs review', error) }
  return { accountId: account.id, userId: account.owner_user_id, contactId: contact.id, conversationId: conversation.id,
    messageId: inbound.messageId, text: dispatchText, replyId: inbound.replyId, isFirstInboundMessage: (count ?? 0) === 0, wasCreated, hasImageEvidence }
}

/** Same precedence as WhatsApp: human pause, sales routing, flows, stored
 * automation blocks, then AI only if nothing deterministic handled it. */
export async function dispatchSocialInbound(db: SupabaseClient, input: SocialDispatchContext) {
  const { data: conversation, error } = await db.from('conversations').select('id,ai_enabled,automation_enabled,last_human_message_at')
    .eq('id', input.conversationId).eq('account_id', input.accountId).eq('contact_id', input.contactId).maybeSingle()
  if (error || !conversation) throw error ?? new Error('Conversación no disponible.')
  const lastHuman = conversation.last_human_message_at ? new Date(conversation.last_human_message_at).getTime() : 0
  const humanRecentlyActive = Date.now() - lastHuman < 5 * 60 * 1000
  if (await handleTeacherInbound(db, { ...input, humanRecentlyActive })) return
  const common = { accountId: input.accountId, userId: input.userId, contactId: input.contactId, conversationId: input.conversationId }
  const followupHandled = input.replyId ? await handleIdleFollowupReply({ ...common, replyId: input.replyId }) : false
  if (!humanRecentlyActive && !followupHandled) await routeInboundSales({ accountId: input.accountId, conversationId: input.conversationId, messageId: input.messageId })
  let consumed = followupHandled, matched = false
  if (conversation.automation_enabled !== false && !humanRecentlyActive && !followupHandled) {
    const flow = await dispatchInboundToFlows({ ...common, isFirstInboundMessage: input.isFirstInboundMessage,
      message: input.replyId ? { kind: 'interactive_reply', reply_id: input.replyId, reply_title: input.text, meta_message_id: input.messageId }
        : { kind: 'text', text: input.text, meta_message_id: input.messageId } })
    consumed = flow.consumed
    const triggers: AutomationTriggerType[] = []
    if (input.isFirstInboundMessage) triggers.push('first_inbound_message')
    if (input.wasCreated) triggers.push('new_contact_created')
    if (!consumed) { triggers.push('new_message_received', 'keyword_match'); if (input.replyId) triggers.push('interactive_reply') }
    for (const triggerType of triggers) {
      matched = await runAutomationsForTrigger({ accountId: input.accountId, contactId: input.contactId, triggerType,
        context: { message_text: input.text, conversation_id: input.conversationId, interactive_reply_id: input.replyId ?? undefined } }) || matched
    }
  }
  if (conversation.ai_enabled !== false && !humanRecentlyActive && !consumed && !matched && !input.replyId && (input.text.trim() || input.hasImageEvidence)) {
    const cancelled = await db.from('automation_pending_executions').update({ status: 'cancelled' }).eq('contact_id', input.contactId).eq('account_id', input.accountId)
      .eq('status', 'pending').is('context->>enrollment_sequence_id', null)
    if (cancelled.error) throw cancelled.error
    await dispatchInboundToAiReply({ accountId: input.accountId, contactId: input.contactId, conversationId: input.conversationId, configOwnerUserId: input.userId })
  }
}
