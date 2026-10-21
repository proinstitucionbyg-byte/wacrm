import { supabaseAdmin } from './admin-client'
import { loadAiConfig } from './config'
import { buildConversationContext } from './context'
import { retrieveKnowledge } from './knowledge'
import { generateReply } from './generate'
import { buildSystemPrompt } from './defaults'
import { findCandidateAutomations, preferredCourseInformationAutomation, preferredEnrollmentAutomation } from './automation-match'
import { routeConversationToArea, explicitlyRequestedArea } from './handoff-routing'
import {
  buildWaitingReminder as waitingReminder,
  buildHandoffNotice,
  scheduleContext,
} from './business-hours'
import { buildHandoffSummary } from './handoff'
import { logAiUsage } from './usage'
import { latestUserMessage } from './query'
import { engineSendText } from '@/lib/flows/meta-send'
import { runAutomationById } from '@/lib/automations/engine'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { academicContext } from '@/lib/matriculas/calendar'
import { studentSupportArea } from './student-support'
import { sentOfferPriceReply } from './sent-offer'
import { verifiedPaymentReply, safePaymentReply } from './payment-details'
import { hasUnfinishedEnrollmentPayment, paidEnrollmentContinuation } from './enrollment-continuation'
import { isLikelyAutomatedInbound } from './automated-inbound'
import { hasRepeatedUnresolvedMessage, isWaitingForRepetitionHandoff, repetitionHandoffArea, REPETITION_HANDOFF_MARKER } from './repetition'
import { isGreetingAutomation } from '@/lib/automations/greeting-continuity'

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
        'assigned_agent_id, ai_autoreply_disabled, ai_reply_count, ai_enabled, ai_handed_off_at, ai_handoff_area, ai_handoff_summary, last_human_message_at',
      )
      .eq('id', conversationId)
      .maybeSingle()
    if (convErr || !conv) return
    if (conv.ai_autoreply_disabled) return
    if (conv.ai_enabled === false) return // turned off here

    const handedOffAt = conv.ai_handed_off_at
      ? new Date(conv.ai_handed_off_at).getTime()
      : 0
    let handedOff =
      handedOffAt > 0 && Date.now() - handedOffAt < HANDOFF_MEMORY_MS

    const messages = await buildConversationContext(db, conversationId)
    if (messages.length === 0) return
    if (isLikelyAutomatedInbound(latestUserMessage(messages))) return
    // A repetition handoff stays with its area until a human answers. Further
    // inbounds get reassurance without another model call or reassignment.
    if (isWaitingForRepetitionHandoff(conv.ai_handoff_summary, conv.ai_handed_off_at, conv.last_human_message_at)) {
      await engineSendText({ accountId, userId: configOwnerUserId, conversationId, contactId,
        text: waitingReminder(), aiGenerated: true })
      return
    }
    const requestedArea = explicitlyRequestedArea(latestUserMessage(messages)) ?? studentSupportArea(latestUserMessage(messages), messages);
    if (requestedArea && requestedArea.toUpperCase() !== conv.ai_handoff_area) handedOff = false;

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

    const latestText = latestUserMessage(messages)
    const enrollmentReply = await paidEnrollmentContinuation(db, accountId, conversationId, latestText)
    const verifiedPayment = requestedArea ? null : verifiedPaymentReply(messages)
    const unfinishedEnrollmentPayment = verifiedPayment
      ? await hasUnfinishedEnrollmentPayment(db, accountId, conversationId)
      : false
    const offerReply = enrollmentReply ?? (unfinishedEnrollmentPayment
      ? 'Ya recibimos tu comprobante de matrícula. No realices otro pago ni vuelvas a enviar el comprobante; estamos completando la revisión de tu registro y te indicaremos si falta algún dato. 😊'
      : verifiedPayment ?? (requestedArea ? null : sentOfferPriceReply(messages)))
    if (offerReply) {
      const { data: claimed, error } = await db.rpc('claim_ai_reply_slot', { conversation_id: conversationId, max_replies: config.autoReplyMaxPerConversation })
      if (!error && claimed === true) await engineSendText({ accountId, userId: configOwnerUserId, conversationId, contactId, text: offerReply, aiGenerated: true })
      return
    }

    const candidates = await findCandidateAutomations(db, accountId, messages)
    const directAutomation = requestedArea ? null :
      preferredEnrollmentAutomation(candidates, messages) ?? preferredCourseInformationAutomation(candidates, messages)
    if (directAutomation) {
      const selectedAutomation = candidates.find(candidate => candidate.id === directAutomation)
      if (selectedAutomation && /yape|plin|medio.?s? de pago|cuenta bancaria/i.test(selectedAutomation.name)
          && await hasUnfinishedEnrollmentPayment(db, accountId, conversationId)) {
        const { data: claimed, error: claimErr } = await db.rpc('claim_ai_reply_slot', {
          conversation_id: conversationId,
          max_replies: config.autoReplyMaxPerConversation,
        })
        if (claimErr || claimed !== true) return
        await engineSendText({ accountId, userId: configOwnerUserId, conversationId, contactId,
          text: 'Ya recibimos tu comprobante de matrícula. No realices otro pago ni vuelvas a enviar el comprobante; estamos completando la revisión de tu registro y te indicaremos si falta algún dato. 😊',
          aiGenerated: true })
        return
      }
      const { data: claimed, error: claimErr } = await db.rpc('claim_ai_reply_slot', {
        conversation_id: conversationId,
        max_replies: config.autoReplyMaxPerConversation,
      })
      if (claimErr || claimed !== true) return
      await runAutomationById({ accountId, automationId: directAutomation, contactId, conversationId, messageText: latestUserMessage(messages) })
      return
    }

    if (hasRepeatedUnresolvedMessage(messages)) {
      const area = repetitionHandoffArea(messages, conv.ai_handoff_area)
      const summary = `${REPETITION_HANDOFF_MARKER} Cinco mensajes iguales sin resolver.\n${buildHandoffSummary({ messages, replyCount: conv.ai_reply_count ?? 0 })}`
      // Compare-and-set prevents concurrent arrivals from routing twice.
      const claimedAt = new Date().toISOString()
      let claim = db.from('conversations').update({ ai_handoff_summary: summary,
        ai_handed_off_at: claimedAt }).eq('id', conversationId).eq('account_id', accountId)
      claim = conv.ai_handed_off_at ? claim.eq('ai_handed_off_at', conv.ai_handed_off_at) : claim.is('ai_handed_off_at', null)
      const { data: claimed, error } = await claim.select('id').maybeSingle()
      if (error || !claimed) return
      if (conv.ai_handed_off_at && (!conv.last_human_message_at || Date.parse(conv.last_human_message_at) <= handedOffAt)) {
        await engineSendText({ accountId, userId: configOwnerUserId, conversationId, contactId,
          text: waitingReminder(), aiGenerated: true })
        return
      }
      let agentId: string | null
      try {
        const routed = await routeConversationToArea(db, accountId, conversationId, area)
        agentId = routed.agentId
      } catch (error) {
        // A failed route must remain retryable rather than falsely claiming
        // the user has already reached a person.
        await db.from('conversations').update({ ai_handoff_summary: conv.ai_handoff_summary ?? null,
          ai_handed_off_at: conv.ai_handed_off_at ?? null }).eq('id', conversationId)
          .eq('account_id', accountId).eq('ai_handed_off_at', claimedAt)
        throw error
      }
      await engineSendText({ accountId, userId: configOwnerUserId, conversationId, contactId,
        text: buildHandoffNotice({ area, agentConnected: Boolean(agentId) }), aiGenerated: true })
      return
    }

    // Repetitions still reach a person even if the AI reply budget is spent.
    if (conv.ai_reply_count >= config.autoReplyMaxPerConversation) return

    const {data: pendingSequence,error: pendingSequenceError} = await db.from('automation_pending_executions')
      .select('automation_id,context').eq('account_id',accountId).eq('contact_id',contactId)
      .in('status',['pending','running']).limit(20)
    if (pendingSequenceError) return
    const continuingSequence = (pendingSequence ?? []).some(row => !isGreetingAutomation(row.automation_id)
      && !row.context?.enrollment_sequence_id && !row.context?.manual_agent_id)
    // Explicit saved requests were handled above. For an off-script question,
    // answer without replacing the sequence that already owns its next step.
    const offeredAutomations = continuingSequence && !requestedArea ? [] : candidates

    // Ground the reply in the account's knowledge base (best-effort).
    const knowledge = await retrieveKnowledge(
      db,
      accountId,
      config,
      latestUserMessage(messages),
    )
    knowledge.push(...await academicContext(db, accountId));
    if (continuingSequence && !requestedArea) knowledge.push('CONTINUIDAD: hay una automatizacion en curso con su siguiente bloque guardado. Responde la consulta puntual por texto y conserva esa secuencia; no reinicies el curso ni propongas ejecutar otra automatizacion. El motor continuara desde el punto guardado respetando sus esperas.')
    knowledge.push('REGISTRO: si la fecha de nacimiento indica que el estudiante es menor de 18 anos, solicita tambien "DNI DEL TUTOR O PADRES". Pide que envie esa foto con la descripcion "DOCUMENTO DEL TUTOR" para identificarla. Si falta la foto del estudiante, solicita NOMBRE COMPLETO, DNI o CARNE DE EXTRANJERIA y CORREO ELECTRONICO por escrito; se conservara ese texto como respaldo y se dejara FOTO DEL DOCUMENTO PENDIENTE. Nunca declares verificada una identidad sin foto. Todos los comprobantes requieren validacion humana del CEO.');

    // Automations the model may launch (best-effort, never throws).
    const systemPrompt = buildSystemPrompt({
      userPrompt: config.systemPrompt,
      mode: 'auto_reply',
      knowledge,
      automations: offeredAutomations,
      handedOff,
      scheduleNote: scheduleContext(),
    })

    const { text: generatedText, handoff, handoffArea, usage, automationId } =
      await generateReply({
        config,
        systemPrompt,
        messages,
      })
    let text = generatedText
    if (text && /\b(?:yape|plin|cuenta|transferencia)\b/i.test(text)
        && await hasUnfinishedEnrollmentPayment(db, accountId, conversationId)) {
      text = 'Ya recibimos tu comprobante de matrícula. No realices otro pago ni vuelvas a enviar el comprobante; estamos completando la revisión de tu registro y te indicaremos si falta algún dato. 😊'
    }

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
      !handoff && automationId && offeredAutomations.some((c) => c.id === automationId)
        ? automationId
        : null

    if (handoff || requestedArea || (!text && !chosenAutomationId)) {
      // Already handed off recently: do not notify again, just reassure.
      // The AI stays on.
      if (handedOff) {
        await engineSendText({
          accountId,
          userId: configOwnerUserId,
          conversationId,
          contactId,
          text: text ? safePaymentReply(text) : waitingReminder(),
          aiGenerated: true,
        })
        return
      }

      // First handoff: (1) remember it, (2) assign a connected agent of the
      // chosen area if there is one, (3) tell the customer once.
      // The AI is NOT switched off.
      const area = requestedArea ?? handoffArea ?? 'ventas'
      const summary = buildHandoffSummary({
        messages,
        replyCount: conv.ai_reply_count ?? 0,
      })
      const update: Record<string, unknown> = {
        ai_handoff_summary: summary,
        ai_handed_off_at: new Date().toISOString(),
      }

      const { agentId } = await routeConversationToArea(db, accountId, conversationId, area);
      const agentConnected = Boolean(agentId);
      await db.from('conversations').update(update).eq('id', conversationId)

      // Optional short apology the model wrote before the marker.
      if (text) {
        await engineSendText({
          accountId,
          userId: configOwnerUserId,
          conversationId,
          contactId,
          text: safePaymentReply(text),
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

    if (text && !chosenAutomationId) {
      await engineSendText({
        accountId,
        userId: configOwnerUserId,
        conversationId,
        contactId,
        text: safePaymentReply(text),
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
