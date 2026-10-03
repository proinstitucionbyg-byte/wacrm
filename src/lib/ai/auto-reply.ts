import { supabaseAdmin } from './admin-client'
import { loadAiConfig } from './config'
import { buildConversationContext } from './context'
import { retrieveKnowledge } from './knowledge'
import { generateReply } from './generate'
import { buildSystemPrompt } from './defaults'
import { findCandidateAutomations } from './automation-match'
import { findConnectedAgentForArea } from './handoff-routing'
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

// ------------------------------------------------------------
// Mensaje que recibe el cliente cuando la IA lo deriva a una persona.
// Puedes cambiar los textos aquí.
// ------------------------------------------------------------
const AREA_LABELS: Record<string, string> = {
  ventas: 'ventas',
  fidelizacion: 'fidelización',
  egresados: 'egresados',
}

function handoffNotice(area: string, agentConnected: boolean): string {
  const label = AREA_LABELS[area] ?? area
  if (agentConnected) {
    return `Gracias por escribirnos 😊 Ya derivé tu consulta con nuestro equipo de ${label}. En unos minutos te atenderán por este mismo chat.`
  }
  return `Gracias por escribirnos 😊 Tu caso ya quedó registrado y derivado a nuestro equipo de ${label}. Te atenderán lo antes posible, apenas haya un asesor disponible dentro de nuestro horario de atención. No necesitas volver a escribir.`
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
 *   - auto-reply was disabled for this conversation (prior handoff)
 *   - the per-conversation reply cap is reached
 *   - there's nothing to reply to
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
        'assigned_agent_id, ai_autoreply_disabled, ai_reply_count, ai_enabled',
      )
      .eq('id', conversationId)
      .maybeSingle()
    if (convErr || !conv) return
    if (conv.ai_autoreply_disabled) return
    if (conv.ai_enabled === false) return // handed off / turned off here
    // Cheap early-out; the authoritative cap check is the atomic claim
    // below (this read can race a concurrent inbound).
    if (conv.ai_reply_count >= config.autoReplyMaxPerConversation) return

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
      // Hand the conversation to a person of the chosen area.
      // 1) Pause the bot on this thread (sticky until re-enabled).
      // 2) Assign a connected agent of that area, if there is one.
      // 3) Tell the customer what is happening.
      const area = handoffArea ?? 'ventas'
      const summary = buildHandoffSummary({
        messages,
        replyCount: conv.ai_reply_count ?? 0,
      })
      const update: Record<string, unknown> = {
        ai_autoreply_disabled: true,
        ai_handoff_summary: summary,
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

      await engineSendText({
        accountId,
        userId: configOwnerUserId,
        conversationId,
        contactId,
        text: handoffNotice(area, agentConnected),
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