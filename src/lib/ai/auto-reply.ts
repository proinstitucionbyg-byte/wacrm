import { supabaseAdmin } from './admin-client'
import { loadAiConfig } from './config'
import { buildConversationContext } from './context'
import { retrieveKnowledge } from './knowledge'
import { generateReply } from './generate'
import { buildSystemPrompt } from './defaults'
import { findCandidateAutomations } from './automation-match'
import { findConnectedAgentForArea } from './handoff-routing'
import {
  SCHEDULE_TEXT,
  buildHandoffNotice,
  isOpenNow,
  nextOpeningText,
  scheduleContext,
} from './business-hours'
import { buildHandoffSummary } from './handoff'
import { logAiUsage } from './usage'
import { latestUserMessage } from './query'
import { engineSendText } from '@/lib/flows/meta-send'
import { runAutomationById } from '@/lib/automations/engine'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'

interface DispatchArgs {
  /** Tenancy key — drives config, contact, and whatsapp_config lookups. */
  accountId: string
  conversationId: string
  contactId: string
  /** The account's WhatsApp config owner, used for the outbound send's
   *  audit columns (mirrors how the flow runner passes it through). */
  configOwnerUserId: string
}

/** For this long after a handoff the AI knows the customer was already told. */
const HANDOFF_MEMORY_MS = 24 * 60 * 60 * 1000

/** Short reassurance when a customer asks again after being handed off. */
function waitingReminder(now: number = Date.now()): string {
  if (isOpenNow(now)) {
    return `Tu caso ya está derivado con nuestro equipo y te escribirán apenas se libere un asesor. Nuestro horario es ${SCHEDULE_TEXT}.`
  }
  return `Tu caso ya está derivado con nuestro equipo. Ahora estamos fuera de horario: te atenderán ${nextOpeningText(now)}. Nuestro horario es ${SCHEDULE_TEXT}.`
}

/**
 * AI auto-reply for a freshly-arrived inbound message.
 *
 * Invoked from the WhatsApp webhook's `after()` block, only when no
 * deterministic flow consumed the message (flows win). Mirrors the flow
 * runner's contract: it owns its try/catch and NEVER throws — a failing
 * or slow LLM call must not affect the webhook's 200 to Meta.
 *
 * Eligibility gates (any → silent no-op):
 *   - AI off / auto-reply disabled for the account
 *   - auto-reply was switched off for this conversation
 *   - the per-conversation reply cap is reached
 *   - there's nothing to reply to
 *
 * A handoff to a person does NOT switch the AI off: the conversation is
 * assigned (visibility for the advisor) and the customer is told once;
 * the AI keeps helping until a human writes (the webhook pauses the AI
 * for a few minutes whenever an advisor sends a message).
 *
 * The 24h WhatsApp session window is inherently open here — we're
 * reacting to a customer message that just landed — so no separate
 * window check is needed.
 */
export async function dispatchInboundToAiReply(
  args: DispatchArgs,
): Promise<void> {
  const { accountId, conversationId, contactId, configOwnerUserId } = args

  try {
    const db = supabaseAdmin()

    const config = await loadAiConfig(db, accountId)
    if (!config || !config.autoReplyEnabled) return

    const { data: conv, error: convErr } = await db
      .from('conversations')
      .select(
        'assigned_agent_id, ai_autoreply_disabled, ai_reply_count, ai_enabled, ai_handed_off_at',
      )
      .eq('id', conversationId)
      .maybeSingle()
    if (convErr || !conv) return
    if (conv.ai_autoreply_disabled) return
    if (conv.ai_enabled === false) return // turned off here
    // Cheap early-out; the authoritative cap check is the atomic claim
    // below (this read can race a concurrent inbound).
    if (conv.ai_reply_count >= config.autoReplyMaxPerConversation) return

    const handedOffAt = conv.ai_handed_off_at
      ? new Date(conv.ai_handed_off_at).getTime()
      : 0
    const handedOff =
      handedOffAt > 0 && Date.now() - handedOffAt < HANDOFF_MEMORY_MS

    const messages = await buildConversationContext(db, conversationId)
    if (messages.length === 0) return

    // Account-wide throttle on the shared BYO key. Over the limit → skip
    // the auto-reply; the inbound still sits in the inbox for a human.
    const acctLimit = checkRateLimit(
      `ai-autoreply:${accountId}`,
      RATE_LIMITS.aiAutoReplyAccount,
    )
    if (!acctLimit.success) {
      console.warn(
        `[ai auto-reply] account ${accountId} hit the per-account rate limit — skipping this inbound.`,
      )
      return
    }

    // Ground the reply in the account's knowledge base (best-effort).
    const knowledge = await retrieveKnowledge(
      db,
      accountId,
      config,
      latestUserMessage(messages),
    )

    // Automations the model may launch (best-effort, never throws).
    const candidates = await findCandidateAutomations(db, accountId, messages)

    const systemPrompt = buildSystemPrompt({
      userPrompt: config.systemPrompt,
      mode: 'auto_reply',
      knowledge,
      automations: candidates,
      handedOff,
      scheduleNote: scheduleContext(),
    })

    const { text, handoff, handoffArea, usage, automationId } =
      await generateReply({
        config,
        systemPrompt,
        messages,
      })

    // Record token spend on the account's BYO key. Fire-and-forget so it
    // never adds latency to the customer-facing send.
    void logAiUsage(db, {
      accountId,
      conversationId,
      mode: 'auto_reply',
      provider: config.provider,
      model: config.model,
      usage,
    })

    // Only accept an automation id the model was actually offered.
    const chosenAutomationId =
      !handoff && automationId && candidates.some((c) => c.id === automationId)
        ? automationId
        : null

    if (handoff || (!text && !chosenAutomationId)) {
      // Already handed off recently: do not notify again, just reassure.
      // The AI stays on.
      if (handedOff) {
        await engineSendText({
          accountId,
          userId: configOwnerUserId,
          conversationId,
          contactId,
          text: text || waitingReminder(),
          aiGenerated: true,
        })
        return
      }

      // First handoff: (1) remember it, (2) assign a connected agent of the
      // chosen area if there is one, (3) tell the customer once.
      // The AI is NOT switched off.
      const area = handoffArea ?? 'ventas'
      const summary = buildHandoffSummary({
        messages,
        replyCount: conv.ai_reply_count ?? 0,
      })
      const update: Record<string, unknown> = {
        ai_handoff_summary: summary,
        ai_handed_off_at: new Date().toISOString(),
      }

      let agentConnected = false
      // Never stomp an existing human assignment.
      if (!conv.assigned_agent_id) {
        const { agentId } = await findConnectedAgentForArea(
          db,
          accountId,
          area,
        )
        if (agentId) {
          update.assigned_agent_id = agentId
          agentConnected = true
        } else if (config.handoffAgentId) {
          update.assigned_agent_id = config.handoffAgentId
        }
      }
      await db.from('conversations').update(update).eq('id', conversationId)

      // Optional short apology the model wrote before the marker.
      if (text) {
        await engineSendText({
          accountId,
          userId: configOwnerUserId,
          conversationId,
          contactId,
          text,
          aiGenerated: true,
        })
      }

      await engineSendText({
        accountId,
        userId: configOwnerUserId,
        conversationId,
        contactId,
        text: buildHandoffNotice({ area, agentConnected }),
        aiGenerated: true,
      })
      return
    }

    // Atomically claim a reply slot: the cap check + increment happen in
    // one UPDATE, so concurrent inbounds can never overshoot the cap.
    const { data: claimed, error: claimErr } = await db.rpc(
      'claim_ai_reply_slot',
      {
        conversation_id: conversationId,
        max_replies: config.autoReplyMaxPerConversation,
      },
    )
    if (claimErr) {
      console.error('[ai auto-reply] claim_ai_reply_slot failed:', claimErr)
      return
    }
    if (claimed !== true) return // lost the per-conversation cap race

    if (text) {
      await engineSendText({
        accountId,
        userId: configOwnerUserId,
        conversationId,
        contactId,
        text,
        aiGenerated: true,
      })
    }

    if (chosenAutomationId) {
      await runAutomationById({
        accountId,
        automationId: chosenAutomationId,
        contactId,
        conversationId,
        messageText: latestUserMessage(messages),
      })
    }
  } catch (err) {
    console.error('[ai auto-reply] dispatch failed:', err)
  }
}