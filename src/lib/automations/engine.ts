import type {
  Automation,
  AutomationLogStepResult,
  AutomationStep,
  AutomationTriggerType,
  ConditionStepConfig,
  KeywordMatchTriggerConfig,
  InteractiveReplyTriggerConfig,
  SendMessageStepConfig,
  SendButtonsStepConfig,
  SendListStepConfig,
  SendTemplateStepConfig,
  SendWebhookStepConfig,
  TagStepConfig,
  UpdateContactFieldStepConfig,
  WaitStepConfig,
  CreateDealStepConfig,
  AssignConversationStepConfig,
  RunAutomationStepConfig,
} from '@/types'
import { supabaseAdmin } from './admin-client'
import {
  engineSendText,
  engineSendTemplate,
  engineSendInteractive,
  engineSendMedia,
} from './meta-send'
import { validateInteractivePayload } from '@/lib/whatsapp/interactive'
import { isDeliverableUrl } from '@/lib/webhooks/ssrf'
import { automationAudioEvidence } from './audio-evidence'
import { greetingAutomationId, INITIAL_GREETING_ID, isGreetingAutomation, matchesGreeting, RETURN_GREETING_ID, shouldShowGreeting } from './greeting-continuity'
import { isLikelyAutomatedInbound } from '@/lib/ai/automated-inbound'
import { HUMAN_PAUSE_MS } from '@/lib/ai/human-pause'
import { captureCourseCheckpoint, currentCourseCheckpoint, isCourseContinue, isCourseDetour, isSavedCourseName, restoreCourseCheckpoint, type CourseCheckpoint } from './course-detour'
import { applyCommercialCadence, readCommercialCadence, type CommercialCadence } from './commercial-cadence'

// ------------------------------------------------------------
// Public API
// ------------------------------------------------------------

export interface AutomationContext {
  /** Pin the approved course cadence only on a new automatic, unbounded run. */
  commercial_cadences?: Record<string, CommercialCadence>
  commercial_started_at?: Record<string, string>
  /** Server-owned enrollment sequence. Its two-hour wait is independent of ordinary chat activity. */
  enrollment_sequence_id?: string
  /** Explicit adviser command; set only by the authenticated server endpoint. */
  manual_agent_id?: string
  /** Raw message text, for keyword_match + message_content conditions. */
  message_text?: string
  /** Previous customer message, captured before inserting this inbound. */
  previous_inbound_at?: string
  /** Provider timestamp of this inbound, used only for greeting continuity. */
  inbound_at?: string
  /** Set only by the one-minute server queue for a configured opening keyword;
   * sends remain billing_status=unknown until Meta confirms pricing. */
  billing_unknown_keyword_fallback?: boolean
  /** Conversation the event belongs to, if any. */
  conversation_id?: string
  /** Arbitrary variables accumulated during execution. */
  vars?: Record<string, unknown>
  /** Server-owned chain history used to stop circular automation links. */
  automation_chain_ids?: string[]
  /** End block for a linked automation, retained when its wait resumes. */
  automation_step_end_by_id?: Record<string, number>
  /** A linked block must finish its own waits before the parent continues. */
  await_child_log_id?: string
  /** WhatsApp accepted this message; later steps wait for its delivery webhook. */
  await_delivery_message_id?: string
  await_delivery_started_at?: string
  await_delivery_fallback_ms?: number
  /** Only the delivery barrier may be resumed early by a Meta status webhook. */
  await_delivery_only?: boolean
  /** The tag id that was added, for tag_added trigger. */
  tag_id?: string
  /** Agent the conversation was assigned to, for conversation_assigned. */
  agent_id?: string
  /** Button / list-row id the customer tapped, for interactive_reply. */
  interactive_reply_id?: string
  /** Exact course wait paused by the payment flow; never guess a new course. */
  payment_resume_pending_id?: string
  payment_activation_at?: string
  payment_resume_previous?: boolean
  course_checkpoint?: CourseCheckpoint
  course_detour_capture?: boolean
  course_detour_resume?: boolean
}

export interface DispatchInput {
  /** Account-level tenancy key. Drives the lookup of which active
   *  automations to fire — `automations.account_id` is the tenant
   *  isolation after migration 017. Replaces the previous `userId`
   *  field; the per-automation user_id is read off each row when
   *  needed (sender identity for outbound messages, log audit). */
  accountId: string
  triggerType: AutomationTriggerType
  contactId?: string | null
  context?: AutomationContext
}

/**
 * Fire all active automations matching the given trigger for an
 * account.
 *
 * Must never throw — callers use fire-and-forget from the webhook.
 * All errors are caught and logged; per-automation failures are
 * recorded into automation_logs with status='failed'.
 */
export async function runAutomationsForTrigger(
  input: DispatchInput,
): Promise<boolean> {
  try {
    if (
      ['new_contact_created', 'first_inbound_message', 'new_message_received', 'keyword_match'].includes(input.triggerType) &&
      isLikelyAutomatedInbound(input.context?.message_text)
    ) {
      console.info('[automations] explicit automated inbound consumed without reply')
      return true
    }
    console.log("========== AUTOMATION START ==========");
    console.log("Trigger:", input.triggerType);
    console.log("Contact:", input.contactId);
    console.log("Account:", input.accountId);

    const db = supabaseAdmin();

    if (input.contactId) {
      const { data: owned, error: ownErr } = await db
        .from("contacts")
        .select("id")
        .eq("id", input.contactId)
        .eq("account_id", input.accountId)
        .maybeSingle();

      if (ownErr) {
        console.error(
          "[automations] contact ownership check failed:",
          ownErr,
        );
        return false;
      }

      if (!owned) {
        console.warn(
          "[automations] contact not in account, refusing dispatch",
          input.contactId,
        );
        return false;
      }
    }

    const { data: automations, error } = await db
      .from("automations")
      .select("*")
      .eq("account_id", input.accountId)
      .eq("trigger_type", input.triggerType)
      .eq("is_active", true);

    if (error) {
      console.error("[automations] fetch failed:", error);
      return false;
    }

    if (!automations || automations.length === 0) {
      return false;
    }

    const ordinaryMatches = (automations as Automation[]).filter((automation) =>
      !isGreetingAutomation(automation.id) && triggerMatches(automation, input.context),
    );
    // One inbound text chooses one route. A broad keyword can otherwise run
    // beside a course-specific block and send two incompatible sequences.
    if (input.triggerType === 'keyword_match') {
      ordinaryMatches.sort((left, right) =>
        matchingKeywordSpecificity(right, input.context?.message_text) - matchingKeywordSpecificity(left, input.context?.message_text)
        || (left.created_at ?? '').localeCompare(right.created_at ?? '')
        || left.id.localeCompare(right.id),
      )
      ordinaryMatches.splice(1)
    }
    const selectedGreetingId = greetingAutomationId(
      input.context?.previous_inbound_at,
      input.context?.inbound_at,
    );
    const greetingMatches = input.triggerType === 'keyword_match' && ordinaryMatches.length === 0
      ? (automations as Automation[]).filter((automation) =>
          automation.id === selectedGreetingId
          && matchesGreeting(automation, input.context?.message_text),
        )
      : [];
    let suppressReturnGreeting = false;
    if (greetingMatches.length > 0 && selectedGreetingId === RETURN_GREETING_ID && input.contactId) {
      const { data: recentGreetings, error: greetingHistoryError } = await db
        .from('automation_logs')
        .select('automation_id')
        .eq('account_id', input.accountId)
        .eq('contact_id', input.contactId)
        .in('automation_id', [INITIAL_GREETING_ID, RETURN_GREETING_ID])
        // A greeting with a scheduled wait is partial after its message was sent.
        .in('status', ['success', 'partial'])
        // Only greetings in this three-hour window can suppress this menu.
        // An old return greeting must not silence a later conversation.
        .gte('created_at', new Date(
          Date.parse(input.context?.inbound_at ?? new Date().toISOString()) - 3 * 60 * 60 * 1000,
        ).toISOString())
        .order('created_at', { ascending: false })
        .limit(1);
      if (greetingHistoryError) {
        console.error('[automations] greeting history lookup failed:', greetingHistoryError);
      } else {
        suppressReturnGreeting = !shouldShowGreeting(selectedGreetingId, recentGreetings?.[0]?.automation_id);
      }
    }
    const selectedAutomations = [...ordinaryMatches, ...(suppressReturnGreeting ? [] : greetingMatches)];

    // An already answered generic greeting is consumed. Do not run the AI
    // fallback or cancel pending follow-up steps just to repeat the same menu.
    let matched = suppressReturnGreeting;
    let cancelledOld = false;

    for (const automation of selectedAutomations) {
      matched = true;
      // A repeated tap on the same option must not restart a sequence that is
      // only waiting for Meta to confirm the previous block.
      if (input.contactId && input.context?.conversation_id && !isGreetingAutomation(automation.id)
          && await hasActiveDeliveryWait(db, input.accountId, input.contactId, automation.id, input.context.conversation_id)) {
        continue;
      }
      if (isCourseContinue(automation) && input.contactId && input.context?.conversation_id) {
        await continueSavedCourse(automation, input.contactId, input.context.conversation_id)
        continue
      }
      const detour = isCourseDetour(automation) && input.contactId && input.context?.conversation_id
        ? await captureCourseCheckpoint(db, input.accountId, input.contactId, input.context.conversation_id) : null
      if (detour) input.context = { ...input.context, course_checkpoint: detour.checkpoint, course_detour_capture: detour.busy }
      const paymentResumeId = isPaymentFlow(automation) && input.contactId
        ? await findPaymentResumeId(db, input.accountId, input.contactId, automation.id, input.context?.conversation_id)
        : undefined;
      // A greeting is only a menu. Its unanswered buttons must not cancel an
      // 18-hour sales/fidelity wait already scheduled for this contact.
      if (input.contactId && !cancelledOld && !isGreetingAutomation(automation.id) && !detour?.busy) {
        cancelledOld = true;
        const cancelQuery = db
          .from("automation_pending_executions")
          .update({ status: "cancelled" })
          .eq("contact_id", input.contactId)
          .eq("account_id", input.accountId)
          .eq("status", "pending")
          .is('context->>enrollment_sequence_id', null);
        if (detour) cancelQuery.is('context->>manual_agent_id', null)
        await cancelQuery
      }
      try {
        await executeAutomation(automation, isPaymentFlow(automation)
          ? { ...input, context: { ...input.context,
              ...(paymentResumeId ? { payment_resume_pending_id: paymentResumeId } : {}),
              payment_activation_at: input.context?.inbound_at ?? new Date().toISOString() } }
          : input);
      } catch (err) {
        console.error(
          "[automations] execute failed:",
          automation.id,
          err,
        );
      }
    }

    

    return matched;
  } catch (err) {
    console.error("[automations] dispatch failed:", err);
    return false;
  }
}

function isPaymentFlow(automation: Pick<Automation, 'name' | 'trigger_config'>): boolean {
  return automation.name === 'YAPE O PLIN'
    || (automation.trigger_config as Record<string, unknown>)?.payment_followup === true
}

async function continueSavedCourse(automation: Automation, contact: string, chat: string): Promise<void> {
  const db = supabaseAdmin()
  const checkpoint = await currentCourseCheckpoint(db, automation.account_id, contact, chat)
  if (checkpoint) {
    const { error } = await db.from('automation_pending_executions').update({ status: 'cancelled' })
      .eq('account_id', automation.account_id).eq('contact_id', contact).eq('status', 'pending')
      .contains('context', { conversation_id: chat, course_checkpoint: checkpoint })
    if (error) throw error
  }
  const result = await restoreCourseCheckpoint(db, { account: automation.account_id, contact, chat, checkpoint, automatic: false })
  await engineSendText({ accountId: automation.account_id, userId: automation.user_id, contactId: contact, conversationId: chat,
    text: result === 'restored' ? '▶️ Continuemos con la información de tu curso desde donde te quedaste. 😊'
      : result === 'human' ? 'Tu consulta continúa con nuestro equipo. Quedamos atentos para ayudarte. 💙'
      : '💬 Cuéntanos qué información deseas revisar para continuar y te ayudamos.' })
}

async function findPaymentResumeId(
  db: ReturnType<typeof supabaseAdmin>, accountId: string, contactId: string, paymentAutomationId: string, conversationId?: string,
): Promise<string | undefined> {
  const { data: waiting, error } = await db.from('automation_pending_executions')
    .select('id,automation_id,context').eq('account_id', accountId).eq('contact_id', contactId)
    .eq('status', 'pending').order('created_at', { ascending: false }).limit(10)
  if (error || !waiting?.length) return undefined
  const scoped = waiting.filter(row => !conversationId
    || (row.context as AutomationContext | null)?.conversation_id === conversationId)
  // A payment button replaces a pending payment reminder, so retain the course
  // that reminder already saved before cancelling it below.
  const inherited = scoped.find(row => (row.context as AutomationContext | null)?.payment_activation_at
    && (row.context as AutomationContext | null)?.payment_resume_pending_id)
  if (inherited) return (inherited.context as AutomationContext).payment_resume_pending_id
  const courseCheckpoint = scoped.find(row => (row.context as AutomationContext | null)?.course_checkpoint)?.context?.course_checkpoint as CourseCheckpoint | undefined
  if (courseCheckpoint?.pending_ids.length) {
    const { data: saved, error: savedError } = await db.from('automation_pending_executions').select('id,context')
      .eq('account_id', accountId).eq('contact_id', contactId).in('id', courseCheckpoint.pending_ids).eq('status', 'cancelled')
    if (savedError) throw savedError
    const leaf = saved?.find(row => row.context?.conversation_id === conversationId && !row.context?.await_child_log_id)
    if (leaf) return (leaf.context as AutomationContext).payment_resume_pending_id ?? leaf.id
  }
  const candidates = scoped.filter(row => row.automation_id !== paymentAutomationId
    && !(row.context as AutomationContext | null)?.enrollment_sequence_id)
  if (!candidates.length) return undefined
  const { data: flows, error: flowsError } = await db.from('automations').select('id,name')
    .eq('account_id', accountId).in('id', [...new Set(candidates.map(row => row.automation_id))])
  if (flowsError) return undefined
  const courseFlowIds = new Set((flows ?? []).filter(flow => isSavedCourseName(flow.name)).map(flow => flow.id))
  return candidates.find(row => courseFlowIds.has(row.automation_id))?.id
}
/**
 * Launch ONE specific automation by id. Used by the AI auto-reply when the
 * model picks an automation. Verifies the contact and the automation both
 * belong to the account and that the automation is active, then runs it
 * exactly like a normal trigger (same steps, waits and buttons).
 *
 * Must never throw. Returns true if the automation was launched.
 */
export async function runAutomationById(input: {
  accountId: string
  automationId: string
  contactId: string
  conversationId: string
  messageText?: string
  manualAgentId?: string
  sequenceId?: string
  requireComplete?: boolean
}): Promise<boolean> {
  try {
    const db = supabaseAdmin()

    const { data: owned } = await db
      .from('contacts')
      .select('id')
      .eq('id', input.contactId)
      .eq('account_id', input.accountId)
      .maybeSingle()
    if (!owned) return false

    const { data: automation, error } = await db
      .from('automations')
      .select('*')
      .eq('id', input.automationId)
      .eq('account_id', input.accountId)
      .eq('is_active', true)
      .maybeSingle()
    if (error || !automation) return false
    if ((automation.trigger_config as Record<string,unknown>)?.internal_only && !input.sequenceId) return false

    if (!input.manualAgentId && !input.sequenceId && await hasActiveDeliveryWait(
      db, input.accountId, input.contactId, input.automationId, input.conversationId,
    )) return true

    if (isCourseContinue(automation)) {
      await continueSavedCourse(automation as Automation, input.contactId, input.conversationId)
      return true
    }
    const detour = isCourseDetour(automation)
      ? await captureCourseCheckpoint(db, input.accountId, input.contactId, input.conversationId) : null
    const paymentResumeId = isPaymentFlow(automation)
      ? await findPaymentResumeId(db, input.accountId, input.contactId, automation.id, input.conversationId)
      : undefined

    // The two existing greetings only show a menu; they preserve prior waits.
    if (!isGreetingAutomation(automation.id) && !detour?.busy) {
      const cancelQuery = db
        .from('automation_pending_executions')
        .update({ status: 'cancelled' })
        .eq('contact_id', input.contactId)
        .eq('account_id', input.accountId)
        .eq('status', 'pending')
        .is('context->>enrollment_sequence_id', null)
      if (detour) cancelQuery.is('context->>manual_agent_id', null)
      await cancelQuery
    }

    const logId = await executeAutomation(automation as Automation, {
      accountId: input.accountId,
      triggerType: 'keyword_match',
      contactId: input.contactId,
      context: {
        message_text: input.messageText ?? '',
        conversation_id: input.conversationId,
        ...(detour ? { course_checkpoint: detour.checkpoint, course_detour_capture: detour.busy } : {}),
        ...(isPaymentFlow(automation) ? {
          ...(paymentResumeId ? { payment_resume_pending_id: paymentResumeId } : {}),
          payment_activation_at: new Date().toISOString(),
        } : {}),
        ...(input.manualAgentId ? { manual_agent_id: input.manualAgentId } : {}),
        ...(input.sequenceId ? { enrollment_sequence_id: input.sequenceId } : {}),
      },
    })
    if (!logId) return false
    const { data: result, error: resultError } = await db.from('automation_logs').select('status').eq('id', logId).single()
    return !resultError && (input.requireComplete
      ? result?.status === 'success'
      : ['success','partial'].includes(result?.status))
  } catch (err) {
    console.error('[automations] runAutomationById failed:', err)
    return false
  }
}

/**
 * Resume a run that was parked at a wait step. Called from the cron
 * endpoint after it grabs a due `automation_pending_executions` row.
 */
export async function resumePendingExecution(pending: {
  id: string
  automation_id: string
  /** Audit-only; the automation row carries account_id for tenancy. */
  user_id: string
  /** Account-scoped lookups read from the automation row, so this
   *  field is just here to mirror the row shape and keep the cron's
   *  pass-through self-documenting. */
  account_id: string
  contact_id: string | null
  log_id: string | null
  parent_step_id: string | null
  branch: 'yes' | 'no' | null
  next_step_position: number
  context: AutomationContext
}): Promise<void> {
  const db = supabaseAdmin()
  const { data: automation, error } = await db
    .from('automations')
    .select('*')
    .eq('id', pending.automation_id)
    .single()

  if (error || !automation) {
    console.error('[automations] resume: missing automation', pending.automation_id, error)
    await markPending(pending.id, 'failed')
    return
  }
  // A manually disabled conversation pauses every automatic sequence,
  // including enrollment welcomes and payment follow-ups. Keep its exact
  // next step so an explicit reactivation can resume it later.
  if (pending.context?.conversation_id) {
    const { data: conv, error: pauseError } = await db.from('conversations')
      .select('automation_enabled')
      .eq('id', pending.context.conversation_id)
      .eq('account_id', pending.account_id)
      .maybeSingle()
    if (pauseError || !conv) {
      await db.from('automation_pending_executions')
        .update({ status: 'pending', run_at: new Date(Date.now() + 60_000).toISOString() })
        .eq('id', pending.id).eq('status', 'running')
      return
    }
    if (conv.automation_enabled === false) {
      await db.from('automation_pending_executions').update({ status: 'paused' })
        .eq('id', pending.id).eq('status', 'running')
      return
    }
  }
  if (isCourseDetour(automation) && pending.context?.course_detour_capture && pending.contact_id && pending.context.conversation_id) {
    try {
      const state = await captureCourseCheckpoint(db, pending.account_id, pending.contact_id, pending.context.conversation_id)
      if (state.busy) {
        await db.from('automation_pending_executions').update({ status: 'pending', run_at: new Date(Date.now() + 30_000).toISOString() })
          .eq('id', pending.id).eq('status', 'running')
        return
      }
      pending.context = { ...pending.context, course_detour_capture: false, course_checkpoint: state.checkpoint }
      const { error: cancelError } = await db.from('automation_pending_executions').update({ status: 'cancelled' })
        .eq('account_id', pending.account_id).eq('contact_id', pending.contact_id).eq('status', 'pending')
        .neq('id', pending.id).is('context->>enrollment_sequence_id', null).is('context->>manual_agent_id', null)
      if (cancelError) throw cancelError
    } catch {
      await markPending(pending.id, 'failed')
      return
    }
  }
  if (isPaymentFlow(automation) && pending.parent_step_id === null
      && (automation.name !== 'YAPE O PLIN' || pending.next_step_position >= 3)) {
    const activatedAt = pending.context?.payment_activation_at ?? pending.context?.inbound_at
    if (!activatedAt || !pending.context?.conversation_id) {
      await finalizeLog(pending.log_id, 'failed', 'Seguimiento de pago sin origen verificable')
      await markPending(pending.id, 'failed')
      return
    }
    const { data: paymentConversation, error: paymentConversationError } = await db.from('conversations')
      .select('automation_enabled,last_human_message_at')
      .eq('id', pending.context.conversation_id).eq('account_id', pending.account_id).maybeSingle()
    if (paymentConversationError || !paymentConversation) {
      await markPending(pending.id, 'failed')
      return
    }
    if (paymentConversation.automation_enabled === false
        || (paymentConversation.last_human_message_at
          && Date.parse(paymentConversation.last_human_message_at) > Date.parse(activatedAt))) {
      await markPending(pending.id, 'cancelled')
      return
    }
    const { data: newerCustomer, error: customerError } = await db.from('messages')
      .select('id').eq('conversation_id', pending.context.conversation_id)
      .eq('sender_type', 'customer').gt('created_at', activatedAt)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (customerError) {
      await markPending(pending.id, 'failed')
      return
    }
    if (newerCustomer) {
      await markPending(pending.id, 'cancelled')
      return
    }
    if (pending.context.payment_resume_previous === true) {
      const previousId = pending.context.payment_resume_pending_id
      if (!previousId) {
        let nextStepQuery = db.from('automation_steps').select('id')
          .eq('automation_id', pending.automation_id)
        if (pending.parent_step_id) nextStepQuery = nextStepQuery.eq('parent_step_id', pending.parent_step_id)
        else nextStepQuery = nextStepQuery.is('parent_step_id', null)
        if (pending.branch) nextStepQuery = nextStepQuery.eq('branch', pending.branch)
        else nextStepQuery = nextStepQuery.is('branch', null)
        nextStepQuery = nextStepQuery.gte('position', pending.next_step_position)
        const endPosition = pending.context.automation_step_end_by_id?.[pending.automation_id]
        if (typeof endPosition === 'number') nextStepQuery = nextStepQuery.lte('position', endPosition)
        const { data: nextSteps, error: nextStepError } = await nextStepQuery.limit(1)
        if (!nextStepError && !nextSteps?.length) {
          await finalizeLog(pending.log_id, 'success', null)
          await markPending(pending.id, 'done')
          return
        }
        await finalizeLog(pending.log_id, 'failed', 'No hay bloque anterior guardado para retomar')
        await markPending(pending.id, 'failed')
        return
      }
      const { data: otherWaits, error: otherWaitError } = await db.from('automation_pending_executions').select('id,context')
        .eq('account_id', pending.account_id).eq('contact_id', pending.contact_id)
        .in('status', ['pending', 'running']).neq('id', pending.id).limit(20)
      if (otherWaitError) {
        await markPending(pending.id, 'failed')
        return
      }
      // The parent is waiting for this linked payment block to finish; it is
      // not a competing course execution.
      if (otherWaits?.some(row => !pending.log_id
          || (row.context as AutomationContext | null)?.await_child_log_id !== pending.log_id)) {
        await markPending(pending.id, 'cancelled')
        return
      }
      const { data: previous } = await db.from('automation_pending_executions')
        .select('id,automation_id,context').eq('id', previousId)
        .eq('account_id', pending.account_id).eq('contact_id', pending.contact_id)
        .eq('status', 'cancelled').maybeSingle()
      const { data: previousFlow } = previous ? await db.from('automations').select('id,name')
        .eq('id', previous.automation_id).eq('account_id', pending.account_id).maybeSingle()
        : { data: null }
      if (!previous || !previousFlow || !isSavedCourseName(previousFlow.name)
          || (previous.context as AutomationContext | null)?.conversation_id !== pending.context.conversation_id) {
        await finalizeLog(pending.log_id, 'failed', 'El bloque anterior no coincide con este chat')
        await markPending(pending.id, 'failed')
        return
      }
      const { data: restored, error: restoreError } = await db.from('automation_pending_executions')
        .update({ status: 'pending', run_at: new Date().toISOString() })
        .eq('id', previousId).eq('account_id', pending.account_id)
        .eq('contact_id', pending.contact_id).eq('status', 'cancelled').select('id').maybeSingle()
      if (restoreError || !restored) {
        await finalizeLog(pending.log_id, 'failed', 'No se pudo retomar el bloque anterior')
        await markPending(pending.id, 'failed')
        return
      }
      await finalizeLog(pending.log_id, 'success', null)
      await markPending(pending.id, 'done')
      return
    }
  }
  // Human attention pauses the existing position; it must not discard it.
  if (pending.context?.enrollment_sequence_id) {
    const {data:sequence,error:sequenceError}=await db.from('enrollment_sequence_runs').select('completed_at,conversation_id,automation_id,stage,status').eq('id',pending.context.enrollment_sequence_id).eq('account_id',pending.account_id).maybeSingle()
    if(sequenceError){await markPending(pending.id,'failed');return}
    if(!sequence || sequence.status!=='started' || sequence.automation_id!==pending.automation_id || sequence.conversation_id!==pending.context.conversation_id || sequence.stage!=='final' || sequence.completed_at || automation.is_active!==true){await markPending(pending.id,'cancelled');return}
    // Ordinary adviser/student messages do not cancel or extend the welcome deadline.
  } else if (pending.context?.manual_agent_id) {
    const { data: profile } = await db.from('profiles').select('account_id').eq('user_id', pending.context.manual_agent_id).maybeSingle()
    const { data: allowed } = await db.rpc('has_member_permission', { p_user_id: pending.context.manual_agent_id, p_module: 'inbox', p_action: 'send' })
    if (profile?.account_id !== pending.account_id || allowed !== true || automation.is_active !== true) {
      await markPending(pending.id, 'cancelled')
      return
    }
  } else if (pending.context?.conversation_id) {
    const { data: conv, error: conversationError } = await db
      .from('conversations')
      .select('automation_enabled, last_human_message_at, automation_disabled_at')
      .eq('id', pending.context.conversation_id)
      .eq('account_id', pending.account_id)
      .maybeSingle()
    if (conversationError || !conv) {
      await markPending(pending.id, conversationError ? 'failed' : 'cancelled')
      return
    }
    if (conv.automation_enabled === false) {
      await markPending(pending.id, 'cancelled')
      return
    }
    const lastHuman = conv?.last_human_message_at
      ? new Date(conv.last_human_message_at).getTime()
      : 0
    const humanActive = Date.now() - lastHuman < HUMAN_PAUSE_MS
    if (humanActive) {
      const disabledAt = Date.parse(conv.automation_disabled_at ?? '')
      const retryAt = Math.max(Date.now() + 60_000,
        lastHuman + HUMAN_PAUSE_MS,
        Number.isFinite(disabledAt) ? disabledAt + HUMAN_PAUSE_MS : 0)
      const { error: deferError } = await db.from('automation_pending_executions')
        .update({status:'pending',run_at:new Date(retryAt).toISOString()})
        .eq('id',pending.id).eq('status','running')
      if (deferError) await markPending(pending.id, 'failed')
      return
    }
  }
  if (pending.context?.await_delivery_message_id) {
    const { data: message, error: messageError } = await db.from('messages')
      .select('status')
      .eq('conversation_id', pending.context.conversation_id)
      .eq('message_id', pending.context.await_delivery_message_id)
      .maybeSingle()
    if (messageError || message?.status === 'failed') {
      const reason = 'El mensaje anterior no se entregó; se detuvo la secuencia para conservar el orden'
      await finalizeLog(pending.log_id, 'failed', reason)
      await markPending(pending.id, 'failed')
      await notifyDeliveryFailure(pending, reason)
      return
    }
    if (message?.status !== 'delivered' && message?.status !== 'read') {
      const startedAt = Date.parse(pending.context.await_delivery_started_at ?? '')
      const fallbackMs = pending.context.await_delivery_fallback_ms ?? 90_000
      if (Number.isFinite(startedAt) && Date.now() - startedAt < fallbackMs) {
        const { error: retryError } = await db.from('automation_pending_executions')
          .update({ status: 'pending', run_at: new Date(Date.now() + 30_000).toISOString() })
          .eq('id', pending.id).eq('status', 'running')
        if (retryError) await markPending(pending.id, 'failed')
        return
      }
      // Some delivered WhatsApp messages never receive a delivery webhook.
      // Continue after a short spacing window rather than losing the sale.
    }
  }
  if (isCourseDetour(automation) && pending.context?.course_detour_resume && pending.contact_id && pending.context.conversation_id) {
    try {
      await restoreCourseCheckpoint(db, { account: pending.account_id, contact: pending.contact_id,
        chat: pending.context.conversation_id, checkpoint: pending.context.course_checkpoint,
        automatic: true, ignorePendingId: pending.id })
      await finalizeLog(pending.log_id, 'success', null)
      await markPending(pending.id, 'done')
    } catch {
      await finalizeLog(pending.log_id, 'failed', 'No se pudo retomar el curso guardado')
      await markPending(pending.id, 'failed')
    }
    return
  }
  if (pending.context?.await_child_log_id) {
    const childLogId = pending.context.await_child_log_id
    const { data: child, error: childError } = await db.from('automation_logs')
      .select('status').eq('id', childLogId).eq('account_id', pending.account_id).maybeSingle()
    if (childError || !child || child.status === 'failed') {
      await finalizeLog(pending.log_id, 'failed', 'El bloque enlazado no terminó correctamente')
      await markPending(pending.id, 'failed')
      return
    }
    if (child.status !== 'success') {
      const { data: childPending, error: pendingError } = await db.from('automation_pending_executions')
        .select('id').eq('log_id', childLogId).in('status', ['pending', 'running']).limit(1)
      if (pendingError || !childPending?.length) {
        await finalizeLog(pending.log_id, 'failed', 'El bloque enlazado se interrumpió')
        await markPending(pending.id, 'cancelled')
        return
      }
      const { error: retryError } = await db.from('automation_pending_executions')
        .update({ status: 'pending', run_at: new Date(Date.now() + 60_000).toISOString() })
        .eq('id', pending.id).eq('status', 'running')
      if (retryError) await markPending(pending.id, 'failed')
      return
    }
  }
  try {
    await executeStepsFrom({
      automation: automation as Automation,
      contactId: pending.contact_id,
      context: { ...(pending.context ?? {}), await_child_log_id: undefined,
        await_delivery_message_id: undefined, await_delivery_started_at: undefined,
        await_delivery_fallback_ms: undefined, await_delivery_only: undefined },
      parentStepId: pending.parent_step_id,
      branch: pending.branch,
      startPosition: pending.next_step_position,
      endPosition: pending.parent_step_id === null
        ? pending.context?.automation_step_end_by_id?.[pending.automation_id]
        : undefined,
      logId: pending.log_id,
      triggerEvent: 'resumed_wait',
      pendingExecutionId: pending.id,
    })
    if(pending.context?.enrollment_sequence_id){
      const {data: outcome,error: outcomeError}=await db.from('automation_logs').select('status').eq('id',pending.log_id).maybeSingle()
      const failed=outcomeError||outcome?.status!=='success'
      await db.from('enrollment_sequence_runs').update(failed?{status:'review',error:'REVISAR ENVIO DE BIENVENIDA'}:{backup_sent_at:new Date().toISOString()}).eq('id',pending.context.enrollment_sequence_id).eq('account_id',pending.account_id)
    }
    await markPending(pending.id, 'done')
  } catch (err) {
    console.error('[automations] resume failed:', err)
    await markPending(pending.id, 'failed')
  }
}

/** Resume the next block as soon as Meta confirms the prior message arrived. */
export async function resumeDeliveredMessage(messageId: string, conversationId: string, accountId: string): Promise<void> {
  try {
    const db = supabaseAdmin()
    const { data: message, error: messageError } = await db.from('messages')
      .select('status').eq('conversation_id', conversationId).eq('message_id', messageId).maybeSingle()
    if (messageError || !['delivered', 'read'].includes(message?.status ?? '')) return

    const { data: pending, error } = await db.from('automation_pending_executions')
      .select('*').eq('account_id', accountId).eq('status', 'pending')
      .contains('context', { conversation_id: conversationId,
        await_delivery_message_id: messageId, await_delivery_only: true })
      .limit(10)
    if (error) {
      console.error('[automations] delivery resume lookup failed:', error)
      return
    }
    for (const row of pending ?? []) {
      if (row.context?.await_delivery_only !== true) continue
      const { data: claim, error: claimError } = await db.from('automation_pending_executions')
        .update({ status: 'running' }).eq('id', row.id).eq('status', 'pending')
        .select('*').maybeSingle()
      if (claimError) {
        console.error('[automations] delivery resume claim failed:', claimError)
        continue
      }
      if (claim) {
        await resumePendingExecution(claim as Parameters<typeof resumePendingExecution>[0])
      }
    }
  } catch (error) {
    // The existing cron remains the recovery path if webhook handling fails.
    console.error('[automations] delivery resume failed:', error)
  }
}

async function hasActiveDeliveryWait(
  db: ReturnType<typeof supabaseAdmin>, accountId: string, contactId: string,
  automationId: string, conversationId: string,
): Promise<boolean> {
  const { data, error } = await db.from('automation_pending_executions')
    .select('context').eq('account_id', accountId).eq('contact_id', contactId)
    .eq('automation_id', automationId).eq('status', 'pending').limit(10)
  if (error) {
    console.error('[automations] active delivery lookup failed:', error)
    return false
  }
  return (data ?? []).some((row) => row.context?.conversation_id === conversationId
    && row.context?.await_delivery_only === true
    && typeof row.context?.await_delivery_message_id === 'string')
}

// ------------------------------------------------------------
// Internal execution
// ------------------------------------------------------------

async function executeAutomation(
  automation: Automation,
  input: DispatchInput,
  triggerEventOverride?: string,
  range?: { startPosition: number; endPosition: number; terminalReentry?: boolean },
) {
  const db = supabaseAdmin()
  const priorChain = input.context?.automation_chain_ids ?? []
  if (priorChain.includes(automation.id) && !range?.terminalReentry) {
    console.warn('[automations] circular automation link blocked:', automation.id)
    return null
  }
  const executionContext: AutomationContext = {
    ...(input.context ?? {}),
    automation_chain_ids: [...priorChain, automation.id],
    automation_step_end_by_id: range
      ? { ...(input.context?.automation_step_end_by_id ?? {}), [automation.id]: range.endPosition }
      : input.context?.automation_step_end_by_id,
  }
  const cadence = !range && !input.context?.manual_agent_id && !input.context?.enrollment_sequence_id
    ? readCommercialCadence((automation.trigger_config as Record<string, unknown>)?.commercial_cadence)
    : null
  if (cadence) {
    executionContext.commercial_cadences = { ...executionContext.commercial_cadences, [automation.id]: cadence }
    executionContext.commercial_started_at = { ...executionContext.commercial_started_at, [automation.id]: new Date().toISOString() }
  }

  const { data: log, error: logErr } = await db
    .from('automation_logs')
    .insert({
      automation_id: automation.id,
      // Tenancy: matches automation.account_id (NOT NULL post-017).
      account_id: automation.account_id,
      // Audit: keeps the historical "author of this automation"
      // pointer so logs still attribute to the right user even
      // after teammates join the account.
      user_id: automation.user_id,
      contact_id: input.contactId ?? null,
      trigger_event: cadence ? `${triggerEventOverride ?? input.triggerType}:commercial_${cadence.version}` : triggerEventOverride ?? input.triggerType,
      steps_executed: [],
      status: 'success',
    })
    .select()
    .single()

  if (logErr || !log) {
    console.error('[automations] cannot create log:', logErr)
    return
  }

  await executeStepsFrom({
    automation,
    contactId: input.contactId ?? null,
    context: executionContext,
    parentStepId: null,
    branch: null,
    startPosition: range?.startPosition ?? 0,
    endPosition: range?.endPosition,
    logId: log.id,
    triggerEvent: triggerEventOverride ?? input.triggerType,
  })

  // Atomic counter update via the SQL function from migration 007.
  // Doing this with a client-side read-modify-write raced when the
  // same automation fired for two contacts simultaneously — both
  // would read N and both write N+1, losing one count permanently.
  const { error: rpcErr } = await db.rpc('increment_automation_execution_count', {
    p_automation_id: automation.id,
  })
  if (rpcErr) {
    console.error('[automations] increment counter failed:', rpcErr)
  }
  return log.id as string
}

interface ExecuteArgs {
  writtenOfferText?: string
  automation: Automation
  contactId: string | null
  context: AutomationContext
  parentStepId: string | null
  branch: 'yes' | 'no' | null
  startPosition: number
  endPosition?: number
  logId: string | null
  triggerEvent: string
  pendingExecutionId?: string
}

async function executeStepsFrom(args: ExecuteArgs): Promise<void> {
  const db = supabaseAdmin()
  if (isCourseDetour(args.automation) && args.context.course_detour_capture) {
    const { error } = await db.from('automation_pending_executions').insert({
      automation_id: args.automation.id, account_id: args.automation.account_id, user_id: args.automation.user_id,
      contact_id: args.contactId, log_id: args.logId, parent_step_id: args.parentStepId, branch: args.branch,
      next_step_position: args.startPosition, context: args.context, run_at: new Date(Date.now() + 30_000).toISOString(), status: 'pending',
    })
    await finalizeLog(args.logId, error ? 'failed' : 'partial', error ? 'No se pudo guardar la consulta pendiente' : null)
    return
  }

  const baseQuery = db
    .from('automation_steps')
    .select('*')
    .eq('automation_id', args.automation.id)
    .gte('position', args.startPosition)
    .order('position', { ascending: true })

  if (args.parentStepId === null && args.endPosition !== undefined) {
    baseQuery.lte('position', args.endPosition)
  }

  const scoped =
    args.parentStepId === null
      ? baseQuery.is('parent_step_id', null)
      : baseQuery.eq('parent_step_id', args.parentStepId).eq('branch', args.branch ?? 'yes')

  const { data: steps, error: stepsErr } = await scoped

  if (stepsErr) {
    await finalizeLog(args.logId, 'failed', stepsErr.message)
    return
  }
  if (!steps || steps.length === 0) {
    if (args.parentStepId === null && args.logId) {
      await finalizeLog(args.logId, 'success', null)
    }
    return
  }

  const cadence = args.parentStepId === null && args.endPosition === undefined
    && !args.context.manual_agent_id && !args.context.enrollment_sequence_id
    ? readCommercialCadence(args.context.commercial_cadences?.[args.automation.id]) : null
  let executionSteps = cadence ? applyCommercialCadence(steps as AutomationStep[], cadence) : steps as AutomationStep[]
  const unpaidPaymentFlow = isPaymentFlow(args.automation)
    && (args.automation.trigger_config as Record<string, unknown>)?.payment_only_unpaid === true
  if ((cadence || unpaidPaymentFlow) && args.context.conversation_id) {
    // A receipt awaiting review is already a payment case, not a silent lead.
    const { data: payment, error: paymentError } = await db.from('payment_reviews').select('id')
      .eq('account_id', args.automation.account_id).eq('conversation_id', args.context.conversation_id)
      .in('status', ['pending', 'validated']).limit(1).maybeSingle()
    if (paymentError) throw paymentError
    const startedAt = args.context.commercial_started_at?.[args.automation.id]
    if (payment) {
      await finalizeLog(args.logId, 'success', 'La atención continúa en revisión de pago')
      return
    }
    // Requested materials remain available, but a later proactive block must
    // not send the same image/audio again. Preserve waits and the terminal UUID.
    const mediaUrls = cadence && args.startPosition > 3 && startedAt ? executionSteps
      .filter(step => step.step_type === 'send_media')
      .map(step => (step.step_config as Record<string, unknown>).media_url ?? (step.step_config as Record<string, unknown>).url)
      .filter((url): url is string => typeof url === 'string') : []
    if (mediaUrls.length) {
      const { data: priorMedia, error: mediaError } = await db.from('messages').select('media_url')
        .eq('conversation_id', args.context.conversation_id).neq('sender_type', 'customer')
        .gte('created_at', startedAt!).in('media_url', mediaUrls).neq('status', 'failed')
      if (mediaError) throw mediaError
      const seen = new Set((priorMedia ?? []).map(row => row.media_url))
      executionSteps = executionSteps.filter(step => step.step_type !== 'send_media'
        || !seen.has((step.step_config as Record<string, unknown>).media_url ?? (step.step_config as Record<string, unknown>).url))
    }
  }
  const results: AutomationLogStepResult[] = []
  let status: 'success' | 'partial' | 'failed' = 'success'
  let errorMessage: string | null = null

  for (const [index, step] of executionSteps.entries()) {
    // An adviser can reply while a block is waiting for delivery or while
    // this loop is advancing. Keep the exact next step instead of sending
    // over the adviser or losing the remaining sequence.
    if (args.context.conversation_id) {
      const { data: conversation, error: pauseError } = await db.from('conversations')
        .select('last_human_message_at,automation_enabled')
        .eq('id', args.context.conversation_id)
        .eq('account_id', args.automation.account_id)
        .maybeSingle()
      if (pauseError) throw pauseError
      if (conversation?.automation_enabled === false) {
        const payload = {
          automation_id: args.automation.id,
          account_id: args.automation.account_id,
          user_id: args.automation.user_id,
          contact_id: args.contactId,
          log_id: args.logId,
          parent_step_id: args.parentStepId,
          branch: args.branch,
          next_step_position: step.position,
          context: args.context,
          run_at: new Date().toISOString(),
          status: 'paused',
        };
        if (args.pendingExecutionId) {
          await db.from('automation_pending_executions').update(payload)
            .eq('id', args.pendingExecutionId).eq('status', 'running');
        } else {
          await db.from('automation_pending_executions').insert(payload);
        }
        await appendResults(args.logId, results, 'partial', null);
        return;
      }
      const humanAt = Date.parse(conversation?.last_human_message_at ?? '')
      const humanActive = Number.isFinite(humanAt) && Date.now() < humanAt + HUMAN_PAUSE_MS
      if (!args.context.manual_agent_id && !args.context.enrollment_sequence_id && humanActive) {
        const runAt = Math.max(Date.now() + 30_000, Number.isFinite(humanAt) ? humanAt + HUMAN_PAUSE_MS : 0)
        const { error: deferError } = await db.from('automation_pending_executions').insert({
          automation_id: args.automation.id, account_id: args.automation.account_id,
          user_id: args.automation.user_id, contact_id: args.contactId, log_id: args.logId,
          parent_step_id: args.parentStepId, branch: args.branch,
          next_step_position: step.position, context: args.context,
          // Retain the next position for review without leaving disabled
          // conversations in the cron queue indefinitely.
          run_at: new Date(runAt).toISOString(), status: 'pending',
        })
        if (deferError) throw deferError
        await appendResults(args.logId, results, 'partial', null)
        return
      }
    }
    // `wait` is the suspension point: enqueue and stop processing this
    // scope. The cron endpoint will pick it up later.
    if (step.step_type === 'wait') {
      const cfg = step.step_config as WaitStepConfig & { resume_previous_course?: boolean }
      const ms = waitMs(cfg)
      const dueAt = new Date(Date.now() + ms).toISOString()
      const {error: waitError} = await db.from('automation_pending_executions').insert({
        automation_id: args.automation.id,
        // Tenancy: account_id required NOT NULL post-017.
        account_id: args.automation.account_id,
        user_id: args.automation.user_id,
        contact_id: args.contactId,
        log_id: args.logId,
        parent_step_id: args.parentStepId,
        branch: args.branch,
        next_step_position: step.position + 1,
        context: { ...args.context, await_delivery_only: undefined,
          ...(args.automation.name === 'YAPE O PLIN' && cfg.resume_previous_course === true
            ? { payment_resume_previous: true } : {}),
          ...(isCourseDetour(args.automation) && cfg.resume_previous_course === true ? { course_detour_resume: true } : {}) },
        run_at: dueAt,
        status: 'pending',
      })
      if (waitError) {
        await finalizeLog(args.logId,'failed','NO SE PUDO PROGRAMAR LA ESPERA')
        return
      }
      if (args.context.enrollment_sequence_id) {
        const {error: dueError}=await db.from('enrollment_sequence_runs').update({welcome_due_at:dueAt}).eq('id',args.context.enrollment_sequence_id).eq('account_id',args.automation.account_id)
        if(dueError){await finalizeLog(args.logId,'failed','REVISAR EL PLAZO DE BIENVENIDA');return}
      }
      results.push({
        step_id: step.id,
        step_type: step.step_type,
        status: 'success',
        detail: `waiting ${cfg.amount} ${cfg.unit}`,
      })
      status = 'partial'
      await appendResults(args.logId, results, status, errorMessage)
      return
    }

    try {
      if (step.step_type === 'condition') {
        const cfg = step.step_config as ConditionStepConfig
        const taken = await evaluateCondition(cfg, args)
        results.push({
          step_id: step.id,
          step_type: 'condition',
          status: 'success',
          detail: `branch=${taken ? 'yes' : 'no'}`,
        })
        // Recurse into the chosen branch at position 0 (children use their
        // own ordering within the branch scope).
        await executeStepsFrom({
          ...args,
          parentStepId: step.id,
          branch: taken ? 'yes' : 'no',
          startPosition: 0,
          logId: args.logId,
        })
        continue
      }

      const outcome = await runStep(step, args)
      const detail = typeof outcome === 'string' ? outcome : outcome.detail
      results.push({
        step_id: step.id,
        step_type: step.step_type,
        status: 'success',
        detail,
      })
      if (typeof outcome !== 'string') {
        const { data: child, error: childError } = await db.from('automation_logs')
          .select('status').eq('id', outcome.childLogId).eq('account_id', args.automation.account_id).maybeSingle()
        if (childError || !child || child.status === 'failed') throw new Error('El bloque enlazado falló')
        if (child.status === 'partial') {
          const { error: waitError } = await db.from('automation_pending_executions').insert({
            automation_id: args.automation.id,
            account_id: args.automation.account_id,
            user_id: args.automation.user_id,
            contact_id: args.contactId,
            log_id: args.logId,
            parent_step_id: args.parentStepId,
            branch: args.branch,
            next_step_position: step.position + 1,
            context: { ...args.context, await_child_log_id: outcome.childLogId },
            run_at: new Date(Date.now() + 60_000).toISOString(),
            status: 'pending',
          })
          if (waitError) throw new Error('No se pudo esperar al bloque enlazado')
          await appendResults(args.logId, results, 'partial', null)
          return
        }
      }
      // Meta's send response only confirms acceptance. A following message
      // can reach the phone first, especially when the prior one is media.
      // Resume through the existing cron only after Meta reports delivery.
      const nextStep = executionSteps[index + 1]
      if (args.context.await_delivery_message_id && nextStep && nextStep.step_type !== 'wait') {
        const { error: deliveryWaitError } = await db.from('automation_pending_executions').insert({
          automation_id: args.automation.id,
          account_id: args.automation.account_id,
          user_id: args.automation.user_id,
          contact_id: args.contactId,
          log_id: args.logId,
          parent_step_id: args.parentStepId,
          branch: args.branch,
          next_step_position: nextStep.position,
          context: { ...args.context, await_delivery_only: true },
          run_at: new Date(Date.now() + 30_000).toISOString(),
          status: 'pending',
        })
        if (deliveryWaitError) throw new Error('No se pudo esperar la entrega del mensaje anterior')
        await appendResults(args.logId, results, 'partial', null)
        await resumeDeliveredMessage(args.context.await_delivery_message_id, args.context.conversation_id!, args.automation.account_id)
        return
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      results.push({
        step_id: step.id,
        step_type: step.step_type,
        status: 'failed',
        detail: msg,
      })
      status = 'failed'
      errorMessage = msg
      break
    }
  }

  if (args.parentStepId === null) {
    await appendResults(args.logId, results, status, errorMessage)
  } else {
    // Nested branch — just append results; parent scope decides final status.
    await appendResults(args.logId, results, null, errorMessage)
  }
}

async function runStep(step: AutomationStep, args: ExecuteArgs): Promise<string | { detail: string; childLogId: string }> {
  const db = supabaseAdmin()

  switch (step.step_type) {
    case 'send_message': {
      const cfg = step.step_config as SendMessageStepConfig
      if (!args.contactId) throw new Error('send_message needs a contact')
      const text = interpolate(cfg.text, args)
      if (!text.trim()) throw new Error('send_message has empty text')
      const conversationId = await resolveConversationId(args)
      const { whatsapp_message_id } = await engineSendText({
        accountId: args.automation.account_id,
        userId: args.automation.user_id,
        conversationId,
        contactId: args.contactId,
        text,
        keywordOpeningFallback: args.context.billing_unknown_keyword_fallback === true,
      })
      rememberWhatsAppDelivery(args, whatsapp_message_id, conversationId)
      args.writtenOfferText = [args.writtenOfferText, text].filter(Boolean).join('\n')
      return `sent via Meta (${whatsapp_message_id})`
    }

    case 'send_buttons':
    case 'send_list': {
      const payload = step.step_config as SendButtonsStepConfig | SendListStepConfig
      if (!args.contactId) throw new Error(`${step.step_type} needs a contact`)
      // Validate against Meta's limits before the network call so a bad
      // payload surfaces as a clear failed-step detail rather than a raw
      // Meta 400 mid-conversation.
      const check = validateInteractivePayload(payload)
      if (!check.ok) throw new Error(check.error)
      const conversationId = await resolveConversationId(args)
      const { whatsapp_message_id } = await engineSendInteractive({
        accountId: args.automation.account_id,
        userId: args.automation.user_id,
        conversationId,
        contactId: args.contactId,
        payload,
        keywordOpeningFallback: args.context.billing_unknown_keyword_fallback === true,
      })
      rememberWhatsAppDelivery(args, whatsapp_message_id, conversationId)
      return `interactive sent via Meta (${whatsapp_message_id})`
    }

    case 'send_template': {
      const cfg = step.step_config as SendTemplateStepConfig
      if (!args.contactId) throw new Error('send_template needs a contact')
      if (!cfg.template_name) throw new Error('send_template needs template_name')
      const conversationId = await resolveConversationId(args)
      // Meta templates use positional {{1}}, {{2}}, … placeholders, so
      // we MUST emit params in strict numeric order. Lexicographic sort
      // of "1", "2", …, "10" yields "1", "10", "2", … which silently
      // scrambles every template with ≥10 variables.
      const params = cfg.variables
        ? Object.keys(cfg.variables)
            .sort((a, b) => {
              const na = Number(a)
              const nb = Number(b)
              const aNum = Number.isFinite(na)
              const bNum = Number.isFinite(nb)
              if (aNum && bNum) return na - nb
              if (aNum) return -1
              if (bNum) return 1
              return a.localeCompare(b)
            })
            .map((k) => String(cfg.variables![k]))
        : []
      const { whatsapp_message_id } = await engineSendTemplate({
        accountId: args.automation.account_id,
        userId: args.automation.user_id,
        conversationId,
        contactId: args.contactId,
        templateName: cfg.template_name,
        language: cfg.language,
        params,
        keywordOpeningFallback: args.context.billing_unknown_keyword_fallback === true,
      })
      rememberWhatsAppDelivery(args, whatsapp_message_id, conversationId)
      return `template sent via Meta (${whatsapp_message_id})`
    }
case 'send_media': {
  const rawCfg = step.step_config as {
    media_type?: 'image' | 'video' | 'audio' | 'document'
    media_url?: string
    url?: string
    caption?: string
    filename?: string
  }

  // Compatibilidad: pasos viejos guardaron el campo como "url" en vez
  // de "media_url". Aceptamos ambos para no romper lo ya creado.
  const mediaUrl = rawCfg.media_url ?? rawCfg.url
  const mediaType = rawCfg.media_type ?? 'image'

  if (!args.contactId) {
    throw new Error('send_media needs a contact')
  }

  if (!mediaUrl) {
    throw new Error('send_media needs media_url (or url)')
  }

  const conversationId = await resolveConversationId(args)

  const transcript = mediaType === 'audio' ? await automationAudioEvidence({
    db, accountId: args.automation.account_id, automationId: args.automation.id,
    name: args.automation.name, stepId: step.id,
    config: step.step_config as Record<string, unknown>, url: mediaUrl,
    writtenText: args.writtenOfferText,
  }) : undefined
  const { whatsapp_message_id } = await engineSendMedia({
    accountId: args.automation.account_id,
    userId: args.automation.user_id,
    conversationId,
    contactId: args.contactId,
    mediaType,
    mediaUrl,
    caption: rawCfg.caption,
    filename: rawCfg.filename,
    transcript,
    keywordOpeningFallback: args.context.billing_unknown_keyword_fallback === true,
  })
  rememberWhatsAppDelivery(args, whatsapp_message_id, conversationId, 90_000)

  if (mediaType === 'image' && rawCfg.caption) {
    args.writtenOfferText = [args.writtenOfferText, rawCfg.caption].filter(Boolean).join('\n')
  }

  return `media sent via Meta (${whatsapp_message_id})`
}
    case 'add_tag': {
      // contact_tags has no account_id column; cross-tenant protection for
      // the attacker-supplied contactId comes from the ownership guard in
      // runAutomationsForTrigger.
      const cfg = step.step_config as TagStepConfig
      if (!args.contactId || !cfg.tag_id) throw new Error('add_tag needs contact + tag_id')
      await db
        .from('contact_tags')
        .upsert(
          { contact_id: args.contactId, tag_id: cfg.tag_id },
          { onConflict: 'contact_id,tag_id', ignoreDuplicates: true },
        )
      return `tag ${cfg.tag_id} added`
    }

    case 'remove_tag': {
      // See add_tag: tenant scoping relies on the runAutomationsForTrigger
      // ownership guard, since contact_tags carries no account_id.
      const cfg = step.step_config as TagStepConfig
      if (!args.contactId || !cfg.tag_id) throw new Error('remove_tag needs contact + tag_id')
      await db
        .from('contact_tags')
        .delete()
        .eq('contact_id', args.contactId)
        .eq('tag_id', cfg.tag_id)
      return `tag ${cfg.tag_id} removed`
    }

    case 'assign_conversation': {
      const cfg = step.step_config as AssignConversationStepConfig
      if (!args.contactId) throw new Error('assign_conversation needs a contact')
      let agentId = cfg.agent_id
      if (cfg.mode === 'round_robin') {
        // Pick any member of the account. The existing implementation
        // only ever returned the automation's author; preserving that
        // shape until a real round-robin algorithm replaces it.
        const { data: profiles } = await db
          .from('profiles')
          .select('user_id')
          .eq('account_id', args.automation.account_id)
          .limit(1)
        agentId = profiles?.[0]?.user_id
      }
      if (!agentId) return 'no agent resolved'
      await db
        .from('conversations')
        .update({ assigned_agent_id: agentId })
        .eq('account_id', args.automation.account_id)
        .eq('contact_id', args.contactId)
      return `assigned to ${agentId}`
    }

    case 'update_contact_field': {
      const cfg = step.step_config as UpdateContactFieldStepConfig
      if (!args.contactId) throw new Error('update_contact_field needs a contact')
      // Resolve workflow variables ({{ vars.* }}, {{ message.text }}) so custom
      // values can be populated dynamically from the triggering context.
      const value = interpolate(cfg.value, args)

      // Custom fields are encoded as `custom:<custom_field_id>`; anything else
      // is a built-in contact column.
      if (cfg.field.startsWith('custom:')) {
        const customFieldId = cfg.field.slice('custom:'.length)
        if (!customFieldId) {
          return `field ${cfg.field} not writable from automations`
        }
        // Defense in depth: the service-role client bypasses RLS, so confirm
        // the field definition belongs to this account before writing.
        const { data: field } = await db
          .from('custom_fields')
          .select('id')
          .eq('id', customFieldId)
          .eq('account_id', args.automation.account_id)
          .maybeSingle()
        if (!field) {
          return `field ${cfg.field} not writable from automations`
        }
        // Upsert on the table's UNIQUE(contact_id, custom_field_id) so repeated
        // runs overwrite rather than duplicate. Tenancy is enforced above and,
        // for the contact side, by the entry-point ownership guard.
        await db
          .from('contact_custom_values')
          .upsert(
            { contact_id: args.contactId, custom_field_id: customFieldId, value },
            { onConflict: 'contact_id,custom_field_id' },
          )
        return `custom field updated`
      }

      const allowed = new Set(['name', 'email', 'company'])
      if (!allowed.has(cfg.field)) {
        return `field ${cfg.field} not writable from automations`
      }
      // Defense in depth: scope the service-role write to the account so
      // a future caller that skips the entry-point ownership guard still
      // cannot write across tenants.
      await db
        .from('contacts')
        .update({ [cfg.field]: value, updated_at: new Date().toISOString() })
        .eq('id', args.contactId)
        .eq('account_id', args.automation.account_id)
      return `${cfg.field} updated`
    }

    case 'create_deal': {
      const cfg = step.step_config as CreateDealStepConfig
      if (!cfg.pipeline_id || !cfg.stage_id) throw new Error('create_deal needs pipeline + stage')
      // Match the account's configured default currency rather than
      // the static `deals.currency` DB default — keeps automation-
      // created deals consistent with the one-currency-per-account
      // rule (issue #218). Fall back to USD if the row is somehow
      // missing the value (pre-021 forks).
      const { data: acct } = await db
        .from('accounts')
        .select('default_currency')
        .eq('id', args.automation.account_id)
        .maybeSingle()
      await db.from('deals').insert({
        // Tenancy + audit, same split as automation_logs above.
        account_id: args.automation.account_id,
        user_id: args.automation.user_id,
        pipeline_id: cfg.pipeline_id,
        stage_id: cfg.stage_id,
        contact_id: args.contactId,
        title: interpolate(cfg.title, args),
        value: cfg.value ?? 0,
        currency: acct?.default_currency ?? 'USD',
        status: 'open',
      })
      return 'deal created'
    }

    case 'run_automation': {
      const cfg = step.step_config as RunAutomationStepConfig
      const targetId = cfg.automation_id?.trim()
      if (!targetId) throw new Error('run_automation needs automation_id')

      const chain = args.context.automation_chain_ids ?? [args.automation.id]
      if (chain.length >= 10) {
        throw new Error('run_automation: maximum chain length reached')
      }

      const hasRange = cfg.start_step !== undefined || cfg.end_step !== undefined
      if (hasRange && (!Number.isInteger(cfg.start_step) || !Number.isInteger(cfg.end_step)
        || (cfg.start_step ?? 0) < 1 || (cfg.end_step ?? 0) < (cfg.start_step ?? 0))) {
        throw new Error('run_automation: invalid block range')
      }

      const { data: target, error } = await db
        .from('automations')
        .select('*')
        .eq('id', targetId)
        .eq('account_id', args.automation.account_id)
        .eq('is_active', true)
        .maybeSingle()
      if (error || !target) {
        throw new Error('run_automation: target is unavailable or inactive')
      }

      if (hasRange) {
        const { data: bounds, error: boundsError } = await db.from('automation_steps')
          .select('position').eq('automation_id', targetId).is('parent_step_id', null)
          .in('position', [(cfg.start_step ?? 1) - 1, (cfg.end_step ?? 1) - 1])
        if (boundsError || !bounds?.some(row => row.position === (cfg.start_step ?? 1) - 1)
          || !bounds?.some(row => row.position === (cfg.end_step ?? 1) - 1)) {
          throw new Error('run_automation: selected block no longer exists')
        }
      }

      // A bounded return to an ancestor is safe only when the selected roots
      // and every nested branch contain no further automation link.
      let terminalReentry = false
      if (chain.includes(targetId)) {
        if (!hasRange) throw new Error('run_automation: circular link blocked')
        const { data: allSteps, error: stepsError } = await db.from('automation_steps')
          .select('id,parent_step_id,position,step_type').eq('automation_id', targetId)
        if (stepsError || !allSteps) throw new Error('run_automation: cannot verify bounded return')
        const selected = new Set(allSteps.filter(row => row.parent_step_id === null
          && row.position >= (cfg.start_step ?? 1) - 1
          && row.position <= (cfg.end_step ?? 1) - 1).map(row => row.id))
        if (!selected.size) throw new Error('run_automation: selected block no longer exists')
        let expanded = true
        while (expanded) {
          expanded = false
          for (const row of allSteps) {
            if (row.parent_step_id && selected.has(row.parent_step_id) && !selected.has(row.id)) {
              selected.add(row.id)
              expanded = true
            }
          }
        }
        if (allSteps.some(row => selected.has(row.id) && row.step_type === 'run_automation')) {
          throw new Error('run_automation: circular link blocked')
        }
        terminalReentry = true
      }

      const childLogId = await executeAutomation(
        target as Automation,
        {
          accountId: args.automation.account_id,
          triggerType: 'new_message_received',
          contactId: args.contactId,
          context: args.context,
        },
        'automation_link',
        hasRange ? { startPosition: (cfg.start_step ?? 1) - 1, endPosition: (cfg.end_step ?? 1) - 1,
          terminalReentry } : undefined,
      )
      if (!childLogId) throw new Error('run_automation: target did not start')
      return { detail: `automation ${targetId} started`, childLogId }
    }

    case 'send_webhook': {
      const cfg = step.step_config as SendWebhookStepConfig
      if (!cfg.url) throw new Error('send_webhook needs url')
      // SSRF guard: the URL and headers are account-controlled and the
      // server makes the request, so refuse any destination that resolves
      // to a private / loopback / link-local / reserved address. Mirrors
      // the webhook_endpoints delivery path (see lib/webhooks/deliver.ts).
      if (!(await isDeliverableUrl(cfg.url))) {
        throw new Error('send_webhook: destination not allowed')
      }
      const body = cfg.body_template ? interpolate(cfg.body_template, args) : JSON.stringify(args.context)
      const res = await fetch(cfg.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(cfg.headers ?? {}) },
        body,
        // Do NOT follow redirects — a public URL could 3xx-bounce to an
        // internal address, defeating the guard above. Bound the request
        // so a hung/slow internal host can't tie up the runner.
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) throw new Error(`webhook returned ${res.status}`)
      return `webhook ${res.status}`
    }

    case 'close_conversation': {
      if (!args.contactId) throw new Error('close_conversation needs a contact')
      await db
        .from('conversations')
        .update({ status: 'closed', updated_at: new Date().toISOString() })
        .eq('account_id', args.automation.account_id)
        .eq('contact_id', args.contactId)
      return 'conversation closed'
    }

    default:
      return `unknown step: ${step.step_type}`
  }
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

/**
 * Pick the conversation a send-type step should use. Prefer the id the
 * webhook handed us (it's the one that just got the inbound message);
 * fall back to the contact's conversation for resumed/wait paths and
 * manual engine POSTs. Throws if none exists — send steps have
 * no meaningful target without a conversation.
 */
function rememberWhatsAppDelivery(args: ExecuteArgs, messageId: string, conversationId: string, fallbackMs = 30_000): void {
  // The enrollment welcome path requires an atomic "complete" result before
  // it marks documents sent. Do not turn that existing guarantee into a
  // partial cron run while adding delivery pacing to ordinary automations.
  if (args.context.enrollment_sequence_id || !messageId.startsWith('wamid.')) {
    args.context.await_delivery_message_id = undefined
    args.context.await_delivery_started_at = undefined
    args.context.await_delivery_fallback_ms = undefined
    return
  }
  args.context.conversation_id = conversationId
  args.context.await_delivery_message_id = messageId
  args.context.await_delivery_started_at = new Date().toISOString()
  args.context.await_delivery_fallback_ms = fallbackMs
}

async function resolveConversationId(args: ExecuteArgs): Promise<string> {
  const fromCtx = args.context.conversation_id
  if (fromCtx) return fromCtx
  if (!args.contactId) throw new Error('cannot resolve conversation: no contact')
  const { data, error } = await supabaseAdmin()
    .from('conversations')
    .select('id')
    .eq('account_id', args.automation.account_id)
    .eq('contact_id', args.contactId)
    .maybeSingle()
  if (error) throw new Error(`conversation lookup failed: ${error.message}`)
  if (!data?.id) throw new Error('no conversation for contact')
  return data.id as string
}

export function triggerMatches(automation: Automation, ctx: AutomationContext | undefined): boolean {
  if ((automation.trigger_config as Record<string,unknown>)?.internal_only === true) return false
  if (automation.trigger_type === 'keyword_match') {
    const cfg = automation.trigger_config as KeywordMatchTriggerConfig
    if (!cfg?.keywords || cfg.keywords.length === 0) return false
    const text = (ctx?.message_text ?? '').toString()
    if (!text) return false
    const haystack = cfg.case_sensitive ? text : text.toLowerCase()
    return cfg.keywords.some((raw) => {
      const k = cfg.case_sensitive ? raw : raw.toLowerCase()
      if (!k.trim()) return false
      return cfg.match_type === 'exact' ? haystack === k : haystack.includes(k)
    })
  }

  // Match on the tapped button / list-row id (exact). Lets multi-step
  // menus be chained: automation A sends buttons, automation B fires on
  // the reply id and sends the next step.
  if (automation.trigger_type === 'interactive_reply') {
    const cfg = automation.trigger_config as InteractiveReplyTriggerConfig
    const replyId = ctx?.interactive_reply_id
    if (!replyId || !Array.isArray(cfg?.reply_ids) || cfg.reply_ids.length === 0) {
      return false
    }
    return cfg.reply_ids.includes(replyId)
  }

  return true
}

function matchingKeywordSpecificity(automation: Automation, messageText: string | undefined): number {
  if (automation.trigger_type !== 'keyword_match' || !messageText) return 0
  const cfg = automation.trigger_config as KeywordMatchTriggerConfig
  const text = cfg.case_sensitive ? messageText : messageText.toLowerCase()
  return Math.max(0, ...cfg.keywords.map((keyword) => {
    const match = cfg.case_sensitive ? keyword : keyword.toLowerCase()
    if (!match.trim()) return 0
    if (!(cfg.match_type === 'exact' ? text === match : text.includes(match))) return 0
    return (cfg.match_type === 'exact' ? 10_000 : 0) + match.length
  }))
}

async function evaluateCondition(cfg: ConditionStepConfig, args: ExecuteArgs): Promise<boolean> {
  const db = supabaseAdmin()
  switch (cfg.subject) {
    case 'tag_presence': {
      if (!args.contactId || !cfg.operand) return false
      // contact_tags has no account_id column (its RLS keys off the parent
      // contact), so tenant scoping here relies on the contact-ownership
      // guard in runAutomationsForTrigger.
      const { count } = await db
        .from('contact_tags')
        .select('id', { count: 'exact', head: true })
        .eq('contact_id', args.contactId)
        .eq('tag_id', cfg.operand)
      return (count ?? 0) > 0
    }
    case 'contact_field': {
      if (!args.contactId || !cfg.operand) return false
      // Scope to the account so the condition can't be turned into a
      // cross-tenant read oracle via the service-role client.
      const { data } = await db
        .from('contacts')
        .select(cfg.operand)
        .eq('id', args.contactId)
        .eq('account_id', args.automation.account_id)
        .maybeSingle()
      const v = (data as Record<string, unknown> | null)?.[cfg.operand]
      return v != null && String(v) === String(cfg.value ?? '')
    }
    case 'message_content': {
      const text = (args.context.message_text ?? '').toString()
      return text.toLowerCase().includes((cfg.value ?? '').toLowerCase())
    }
    case 'time_of_day': {
      // operand form "HH:mm-HH:mm" — true if now is within that window
      // (supports over-midnight ranges like "18:00-09:00").
      const [from, to] = (cfg.operand ?? '').split('-')
      if (!from || !to) return false
      const now = new Date()
      const mins = now.getHours() * 60 + now.getMinutes()
      const parse = (s: string) => {
        const [h, m] = s.split(':').map(Number)
        return (h || 0) * 60 + (m || 0)
      }
      const f = parse(from)
      const t = parse(to)
      return f <= t ? mins >= f && mins < t : mins >= f || mins < t
    }
    default:
      return false
  }
}

function waitMs(cfg: WaitStepConfig): number {
  const unitMs = cfg.unit === 'days' ? 86_400_000 : cfg.unit === 'hours' ? 3_600_000 : 60_000
  return Math.max(1_000, cfg.amount * unitMs)
}

function interpolate(s: string, args: ExecuteArgs): string {
  return s.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const [ns, prop] = String(key).split('.')
    if (ns === 'message' && prop === 'text') return String(args.context.message_text ?? '')
    if (ns === 'vars' && prop) return String(args.context.vars?.[prop] ?? '')
    return ''
  })
}

async function appendResults(
  logId: string | null,
  newItems: AutomationLogStepResult[],
  status: 'success' | 'partial' | 'failed' | null,
  errorMessage: string | null,
) {
  if (!logId) return
  const db = supabaseAdmin()
  const { data: existing } = await db
    .from('automation_logs')
    .select('steps_executed, status')
    .eq('id', logId)
    .single()
  const merged = [
    ...((existing?.steps_executed as AutomationLogStepResult[] | undefined) ?? []),
    ...newItems,
  ]
  const update: Record<string, unknown> = { steps_executed: merged }
  // Only overwrite status on the outermost scope — nested branches pass null.
  if (status !== null) {
    update.status = status
  }
  if (errorMessage) update.error_message = errorMessage
  await db.from('automation_logs').update(update).eq('id', logId)
}

async function finalizeLog(
  logId: string | null,
  status: 'success' | 'partial' | 'failed',
  errorMessage: string | null,
) {
  if (!logId) return
  await supabaseAdmin()
    .from('automation_logs')
    .update({ status, error_message: errorMessage })
    .eq('id', logId)
}

async function markPending(id: string, status: 'done' | 'failed' | 'cancelled') {
  await supabaseAdmin()
    .from('automation_pending_executions')
    .update({ status })
    .eq('id', id)
    .eq('status', 'running')
}

async function notifyDeliveryFailure(
  pending: { account_id: string; contact_id: string | null; log_id: string | null; context: AutomationContext },
  reason: string,
): Promise<void> {
  if (!pending.context.conversation_id) return
  try {
    const db = supabaseAdmin()
    const { data: profiles, error } = await db.from('profiles')
      .select('user_id,account_role').eq('account_id', pending.account_id)
    if (error) throw error
    const admins = (profiles ?? []).filter(profile => ['owner', 'admin'].includes(profile.account_role))
    if (!admins.length) return
    const { error: noticeError } = await db.from('notifications').upsert(
      admins.map(profile => ({
        account_id: pending.account_id,
        user_id: profile.user_id,
        type: 'system_notice',
        conversation_id: pending.context.conversation_id,
        contact_id: pending.contact_id,
        title: 'AUTOMATIZACIÓN PAUSADA · ENTREGA SIN CONFIRMAR',
        body: `${reason}. Revisa el chat antes de reanudar o escribir de nuevo.`,
        target_url: `/inbox?c=${pending.context.conversation_id}`,
        dedup_key: `automation-delivery:${pending.log_id}`,
      })),
      { onConflict: 'account_id,user_id,dedup_key', ignoreDuplicates: true },
    )
    if (noticeError) throw noticeError
  } catch (error) {
    console.error('[automations] delivery failure notice failed:', error)
  }
}
