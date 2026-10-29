import type { SupabaseClient } from '@supabase/supabase-js'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { inboundRoutingText } from '@/lib/automations/routing-text'
import { dispatchInboundToFlows } from '@/lib/flows/engine'
import { isLikelyAutomatedInbound } from '@/lib/ai/automated-inbound'
import { isExplicitSalesDecline } from '@/lib/ai/sales-decline'
import { handleExplicitHumanRequest } from '@/lib/ai/explicit-human-request'
import { canAutoReplyToInboundImage } from '@/lib/ai/inbound-image-routing'
import { HUMAN_PAUSE_MS } from '@/lib/ai/human-pause'
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply'
import { handleTeacherInbound } from '@/lib/matriculas/teachers'
import { routeInboundSales } from '@/lib/ai/sales-routing'
import { tagCommercialInquiry } from '@/lib/sales/attribution'
import { gateAutomaticWhatsAppConversation } from './billing-runtime'
import { hasPendingDeferredKeywordOpening } from './deferred-keyword-openings'
import { pauseUnknownFirstInboundForHuman } from './first-inbound-routing'
import { handleIdleFollowupReply } from '@/lib/ai/followup'
import type { ImageAnalysis } from '@/lib/ai/analyze-image'

type ConversationControls = {
  ai_enabled?: boolean | null
  automation_enabled?: boolean | null
  last_human_message_at?: string | null
}

/**
 * Shared post-persistence path for Cloud webhook and owner-linked WhatsApp
 * sessions. The engines and their saved branches stay in the CRM; only the
 * transport differs. Session sends are separately gated by the P061 queue.
 */
export async function dispatchInboundThroughCrm(args: {
  db: SupabaseClient
  channel: 'cloud' | 'session'
  accountId: string
  userId: string
  contactId: string
  conversationId: string
  messageId: string
  contentText: string | null
  audioTranscript?: string | null
  imageAnalysis?: ImageAnalysis | null
  isFirstInboundMessage: boolean
  previousInboundAt?: string
  inboundAt: string
  contactCreated: boolean
  hasConfirmedAdOrigin: boolean
  interactiveReplyId?: string | null
  conversation: ConversationControls
}): Promise<void> {
  const { db } = args
  const lastHuman = args.conversation.last_human_message_at
    ? Date.parse(args.conversation.last_human_message_at)
    : 0
  const humanRecentlyActive = Date.now() - lastHuman < HUMAN_PAUSE_MS
  const inboundText = inboundRoutingText(args.contentText, args.audioTranscript)
  const automatedInbound = isLikelyAutomatedInbound(inboundText)
  const imageAnalysis = args.imageAnalysis ?? null
  const interactiveReplyId = args.interactiveReplyId ?? null

  await tagCommercialInquiry(db, {
    accountId: args.accountId,
    contactId: args.contactId,
    userId: args.userId,
    text: inboundText,
    firstInbound: args.isFirstInboundMessage,
    hasAdReferral: args.hasConfirmedAdOrigin,
  })

  const firstInboundDisposition = await pauseUnknownFirstInboundForHuman(db, {
    accountId: args.accountId,
    conversationId: args.conversationId,
    contactId: args.contactId,
    userId: args.userId,
    isFirstInboundMessage: args.isFirstInboundMessage,
    text: inboundText,
    hasConfirmedAdOrigin: args.hasConfirmedAdOrigin,
    messageId: args.messageId,
    receivedAt: args.inboundAt,
    contactCreated: args.contactCreated,
    channel: args.channel,
  })
  const unknownFirstInboundNeedsHuman = firstInboundDisposition === 'human'
  const keywordOpeningDeferred = firstInboundDisposition === 'deferred'
    || (!args.isFirstInboundMessage && await hasPendingDeferredKeywordOpening(db, args.accountId, args.conversationId))
  const salesDeclined = !automatedInbound && isExplicitSalesDecline(inboundText)
  const explicitHumanRequested = !automatedInbound && await handleExplicitHumanRequest(db, {
    accountId: args.accountId,
    conversationId: args.conversationId,
    contactId: args.contactId,
    userId: args.userId,
    text: inboundText,
    replyId: interactiveReplyId,
  })

  if (salesDeclined) {
    const { error: disableError } = await db.from('conversations')
      .update({ ai_enabled: false, automation_enabled: false, automation_disabled_at: new Date().toISOString() })
      .eq('id', args.conversationId).eq('account_id', args.accountId)
    if (disableError) throw disableError
    const { error: cancelError } = await db.from('automation_pending_executions')
      .update({ status: 'cancelled' })
      .eq('account_id', args.accountId).eq('contact_id', args.contactId)
      .eq('status', 'pending')
      .is('context->>enrollment_sequence_id', null)
      .is('context->>manual_agent_id', null)
    if (cancelError) throw cancelError
  }

  let billingBlockedForThisInbound = false
  const automaticWasEnabled = args.conversation.ai_enabled !== false || args.conversation.automation_enabled !== false
  if (args.channel === 'cloud' && !explicitHumanRequested && !unknownFirstInboundNeedsHuman &&
      !keywordOpeningDeferred && !salesDeclined && automaticWasEnabled) {
    const billingGate = await gateAutomaticWhatsAppConversation(db, {
      accountId: args.accountId,
      conversationId: args.conversationId,
      contactId: args.contactId,
    })
    billingBlockedForThisInbound = !billingGate.allowed
  }
  const allAutomaticRepliesDisabled = explicitHumanRequested || unknownFirstInboundNeedsHuman ||
    keywordOpeningDeferred || salesDeclined || billingBlockedForThisInbound ||
    (args.conversation.ai_enabled === false && args.conversation.automation_enabled === false)

  const followupReplyHandled = !allAutomaticRepliesDisabled && interactiveReplyId
    ? await handleIdleFollowupReply({
      accountId: args.accountId,
      userId: args.userId,
      contactId: args.contactId,
      conversationId: args.conversationId,
      replyId: interactiveReplyId,
    })
    : false

  let teacherHandled = false
  try {
    if (!allAutomaticRepliesDisabled) teacherHandled = await handleTeacherInbound(db, {
      accountId: args.accountId,
      conversationId: args.conversationId,
      contactId: args.contactId,
      userId: args.userId,
      messageId: args.messageId,
      text: inboundText,
      humanRecentlyActive,
    })
  } catch (error) {
    console.error('[teacher] cancellation requires review', error)
  }

  if (!allAutomaticRepliesDisabled && !automatedInbound && !teacherHandled && !humanRecentlyActive && !followupReplyHandled) {
    await routeInboundSales({ accountId: args.accountId, conversationId: args.conversationId, messageId: args.messageId })
  }

  const automationPaused = explicitHumanRequested || unknownFirstInboundNeedsHuman || keywordOpeningDeferred ||
    salesDeclined || billingBlockedForThisInbound || args.conversation.automation_enabled === false ||
    automatedInbound || humanRecentlyActive || followupReplyHandled || teacherHandled
  let automationMatched = false
  let flowConsumed = explicitHumanRequested || unknownFirstInboundNeedsHuman || keywordOpeningDeferred ||
    automatedInbound || followupReplyHandled || teacherHandled

  if (!automationPaused) {
    const flowResult = await dispatchInboundToFlows({
      accountId: args.accountId,
      userId: args.userId,
      contactId: args.contactId,
      conversationId: args.conversationId,
      message: interactiveReplyId
        ? { kind: 'interactive_reply', reply_id: interactiveReplyId, reply_title: args.contentText ?? '', meta_message_id: args.messageId }
        : { kind: 'text', text: inboundText, meta_message_id: args.messageId },
      isFirstInboundMessage: args.isFirstInboundMessage,
    })
    flowConsumed = flowResult.consumed
  }

  const automationTriggers: ('new_contact_created' | 'first_inbound_message' | 'new_message_received' | 'keyword_match' | 'interactive_reply')[] = []
  if (!automationPaused) {
    if (!flowConsumed) {
      automationTriggers.push('new_message_received', 'keyword_match')
      if (interactiveReplyId) automationTriggers.push('interactive_reply')
    }
    if (args.contactCreated) automationTriggers.unshift('new_contact_created')
    if (args.isFirstInboundMessage) automationTriggers.unshift('first_inbound_message')
  }

  for (const triggerType of automationTriggers) {
    const matched = await runAutomationsForTrigger({
      accountId: args.accountId,
      triggerType,
      contactId: args.contactId,
      context: {
        message_text: inboundText,
        conversation_id: args.conversationId,
        interactive_reply_id: interactiveReplyId ?? undefined,
        previous_inbound_at: args.previousInboundAt,
        inbound_at: args.inboundAt,
        inbound_message_id: args.messageId,
      },
    })
    if (matched) automationMatched = true
  }

  if (args.conversation.ai_enabled !== false && !explicitHumanRequested && !salesDeclined &&
      !humanRecentlyActive && !flowConsumed && !automationMatched &&
      (!interactiveReplyId || interactiveReplyId.startsWith('payment_followup_')) &&
      canAutoReplyToInboundImage(imageAnalysis) && (inboundText.trim() || imageAnalysis !== null)) {
    await dispatchInboundToAiReply({
      accountId: args.accountId,
      conversationId: args.conversationId,
      contactId: args.contactId,
      configOwnerUserId: args.userId,
    })
  }
}
