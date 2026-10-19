import { supabaseAdmin } from './admin-client'
import { loadAiConfig } from './config'
import { buildConversationContext } from './context'
import { conversationCourse, findCandidateAutomations } from './automation-match'
import { runAutomationById } from '@/lib/automations/engine'
import { engineSendInteractive } from '@/lib/automations/meta-send'
import { engineSendText } from '@/lib/flows/meta-send'
import { findConnectedAgentForArea, routeConversationToArea } from './handoff-routing'
import { buildHandoffSummary } from './handoff'
import { buildHandoffNotice } from './business-hours'
import { isLikelyAutomatedInbound } from './automated-inbound'
import { courseKey } from '@/lib/matriculas/calendar'
import { isGreetingAutomation } from '@/lib/automations/greeting-continuity'
import { isWaitingForRepetitionHandoff } from './repetition'
import { HUMAN_PAUSE_MS } from './human-pause'
import { idleFollowupArea, latestCourseSequenceFinished, promisedHumanSupport } from './followup-policy'

const IDLE_MS = 10 * 60 * 1000
const WINDOW_MS = 24 * 60 * 60 * 1000
const REFUSAL = /no me interesa|no gracias|ya no|no quiero/i
export const FOLLOWUP_CONTINUE_ID = 'vortex_followup_continue'
export const FOLLOWUP_SALES_ID = 'vortex_followup_ventas'
export const FOLLOWUP_LOYALTY_ID = 'vortex_followup_fidelizacion'
export const IDLE_FOLLOWUP_TEXT = 'Para ayudarte, escríbenos qué necesitas: información de cursos o apoyo con tus clases.'
const IDLE_FOLLOWUP_BUTTON_TEXT = '¿Quieres que retomemos la conversación? Pulsa continuar y te ayudamos a elegir el área.'

export function needsIdleTextFallback(last: { sender_type: string; content_type?: string; content_text: string | null; status?: string; created_at?: string }, followedUpAt?: string | null): boolean {
  return last.sender_type === 'bot' && last.content_type === 'interactive'
    && last.status === 'failed' && last.content_text === IDLE_FOLLOWUP_BUTTON_TEXT
    && (!last.created_at || !followedUpAt || Date.parse(followedUpAt) < Date.parse(last.created_at))
}

export function alreadyFollowedUp(customerAt: string, followedUpAt: string | null): boolean {
  return Boolean(followedUpAt && Date.parse(followedUpAt) >= Date.parse(customerAt))
}

/** A saved block already owns this question, even if its run started hours ago. */
export function isSavedAutomationMessage(messageId: string | null, runs: Array<{
  automation_id: string
  steps_executed: unknown
}>): boolean {
  if (!messageId) return false
  return runs.some(run => !isGreetingAutomation(run.automation_id)
    && Array.isArray(run.steps_executed)
    && run.steps_executed.some(step => typeof step?.detail === 'string'
      && step.detail.includes(`(${messageId})`)))
}

export function canFollowUpAfterLastMessage(
  senderType: string,
  text: string | null,
): boolean {
  if (senderType === 'customer' || senderType === 'agent') return true
  return senderType === 'bot' && /[?¿]/.test(text ?? '')
}

/** Handle the Continue → area menu sent by the idle follow-up. */
export async function handleIdleFollowupReply(args: {
  accountId: string
  userId: string
  contactId: string
  conversationId: string
  replyId: string
}): Promise<boolean> {
  const { accountId, userId, contactId, conversationId, replyId } = args
  if (
    replyId !== FOLLOWUP_CONTINUE_ID &&
    replyId !== FOLLOWUP_SALES_ID &&
    replyId !== FOLLOWUP_LOYALTY_ID
  ) {
    return false
  }

  try {
    const db = supabaseAdmin()

    if (replyId === FOLLOWUP_CONTINUE_ID) {
      await engineSendInteractive({
        accountId,
        userId,
        contactId,
        conversationId,
        payload: {
          kind: 'buttons',
          body: 'Claro, ¿con qué área deseas continuar?',
          buttons: [
            { id: FOLLOWUP_SALES_ID, title: 'Ventas' },
            { id: FOLLOWUP_LOYALTY_ID, title: 'Fidelización' },
          ],
        },
      })
      await db
        .from('conversations')
        .update({ followup_sent_at: new Date().toISOString() })
        .eq('id', conversationId)
        .eq('account_id', accountId)
      return true
    }

    const area = replyId === FOLLOWUP_SALES_ID ? 'ventas' : 'fidelizacion'
    const { data: conversation, error } = await db
      .from('conversations')
      .select('assigned_agent_id, ai_reply_count')
      .eq('id', conversationId)
      .eq('account_id', accountId)
      .maybeSingle()
    if (error || !conversation) {
      console.error('[followup] failed to load conversation for area selection:', error)
      return true
    }

    const messages = await buildConversationContext(db, conversationId)
    const summary = buildHandoffSummary({
      messages,
      replyCount: conversation.ai_reply_count ?? 0,
    })
    const update: Record<string, unknown> = {
      ai_handoff_summary: summary,
      ai_handed_off_at: new Date().toISOString(),
    }
    let agentConnected = false

    if (!conversation.assigned_agent_id) {
      const { agentId } = await findConnectedAgentForArea(db, accountId, area)
      if (agentId) {
        update.assigned_agent_id = agentId
        agentConnected = true
      } else {
        const config = await loadAiConfig(db, accountId)
        if (config?.handoffAgentId) {
          update.assigned_agent_id = config.handoffAgentId
        }
      }
    }

    const { error: updateError } = await db
      .from('conversations')
      .update(update)
      .eq('id', conversationId)
      .eq('account_id', accountId)
    if (updateError) {
      console.error('[followup] failed to route area selection:', updateError)
      return true
    }

    await engineSendText({
      accountId,
      userId,
      contactId,
      conversationId,
      text: buildHandoffNotice({ area, agentConnected }),
      aiGenerated: true,
    })
    await db
      .from('conversations')
      .update({ followup_sent_at: new Date().toISOString() })
      .eq('id', conversationId)
      .eq('account_id', accountId)
    return true
  } catch (err) {
    console.error('[followup] failed to handle Continue reply:', err)
    return true
  }
}

/** Re-enable only timed controls; a null disabled_at is an indefinite manual pause. */
export async function reactivateExpiredManualControls(): Promise<number> {
  const db = supabaseAdmin()
  const cutoff = new Date(Date.now() - HUMAN_PAUSE_MS).toISOString()
  let reactivated = 0

  const [aiResult, automationResult] = await Promise.all([
    db
      .from('conversations')
      .select('id, ai_disabled_at')
      .eq('ai_enabled', false)
      .lte('ai_disabled_at', cutoff)
      .order('ai_disabled_at', { ascending: true })
      .limit(100),
    db
      .from('conversations')
      .select('id, automation_disabled_at')
      .eq('automation_enabled', false)
      .lte('automation_disabled_at', cutoff)
      .order('automation_disabled_at', { ascending: true })
      .limit(100),
  ])

  if (aiResult.error) {
    console.error('[followup] failed to load expired AI controls:', aiResult.error)
  } else {
    reactivated += await reactivateRows(
      (aiResult.data ?? []).map((row) => ({
        id: row.id,
        disabled_at: row.ai_disabled_at,
      })),
      'ai_enabled',
      'ai_disabled_at',
    )
  }

  if (automationResult.error) {
    console.error(
      '[followup] failed to load expired automation controls:',
      automationResult.error,
    )
  } else {
    reactivated += await reactivateRows(
      (automationResult.data ?? []).map((row) => ({
        id: row.id,
        disabled_at: row.automation_disabled_at,
      })),
      'automation_enabled',
      'automation_disabled_at',
    )
  }

  return reactivated
}

async function reactivateRows(
  rows: Array<{ id: string; disabled_at: string | null }>,
  enabledColumn: 'ai_enabled' | 'automation_enabled',
  disabledAtColumn: 'ai_disabled_at' | 'automation_disabled_at',
): Promise<number> {
  const db = supabaseAdmin()
  let reactivated = 0

  for (const row of rows) {
    if (!row.disabled_at) continue
    const { data, error } = await db
      .from('conversations')
      .update({ [enabledColumn]: true, [disabledAtColumn]: null })
      .eq('id', row.id)
      .eq(enabledColumn, false)
      .eq(disabledAtColumn, row.disabled_at)
      .select('id')
      .maybeSingle()

    if (error) {
      console.error('[followup] failed to reactivate manual control:', error)
    } else if (data) {
      reactivated++
    }
  }

  return reactivated
}

/** If the customer has been waiting for 10 minutes, resume a matching
 * course automation or ask them to choose how they want to continue. */
export async function runIdleFollowups(): Promise<number> {
  let launched = 0
  try {
    const db = supabaseAdmin()
    const now = Date.now()
    const { data: convs, error } = await db
      .from('conversations')
      .select(
        'id, account_id, user_id, contact_id, last_message_at, followup_sent_at, last_human_message_at, ai_handoff_summary, ai_handed_off_at, ai_handoff_area, assigned_agent_id',
      )
      .lt('last_message_at', new Date(now - IDLE_MS).toISOString())
      .gt('last_message_at', new Date(now - WINDOW_MS).toISOString())
      .eq('ai_enabled', true)
      .eq('automation_enabled', true)
      .neq('status', 'closed')
      .order('last_message_at', { ascending: false })
      .limit(50)
    if (error || !convs) return 0

    for (const c of convs) {
      if (isWaitingForRepetitionHandoff(c.ai_handoff_summary, c.ai_handed_off_at, c.last_human_message_at)) continue
      const lastHuman = c.last_human_message_at
        ? new Date(c.last_human_message_at).getTime()
        : 0
      if (now - lastHuman < HUMAN_PAUSE_MS) continue

      const { data: last } = await db
        .from('messages')
        .select('sender_type, content_type, content_text, created_at, message_id, status')
        .eq('conversation_id', c.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (!last) continue

      const completedMessageOwners = new Set<string>()
      const { data: recentRuns, error: runsError } = await db.from('automation_logs')
        .select('automation_id, status, steps_executed, created_at')
        .eq('account_id', c.account_id).eq('contact_id', c.contact_id)
        .order('created_at', { ascending: false }).limit(100)
      if (runsError) continue
      if (last.sender_type === 'bot' && last.message_id) {
        for (const run of recentRuns ?? []) {
          if (isSavedAutomationMessage(last.message_id, [run])) completedMessageOwners.add(run.automation_id)
        }
      }

      const { data: customer } = last.sender_type === 'customer'
        ? { data: last }
        : await db.from('messages')
            .select('sender_type, content_text, created_at')
            .eq('conversation_id', c.id)
            .eq('sender_type', 'customer')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
      if (!customer || now - Date.parse(customer.created_at) >= WINDOW_MS) continue
      const textFallback = needsIdleTextFallback(last, c.followup_sent_at)
      // Sending our own follow-up changes last_message_at. It must never
      // count as a new customer request and schedule another follow-up.
      const activityAt = lastHuman > Date.parse(customer.created_at)
        ? c.last_human_message_at : customer.created_at
      if (alreadyFollowedUp(activityAt, c.followup_sent_at) && !textFallback) continue
      if (isLikelyAutomatedInbound(customer.content_text)) {
        await claimFollowup(db, c)
        continue
      }

      if (REFUSAL.test(customer.content_text ?? '')) {
        await claimFollowup(db, c)
        continue
      }
      // The idle follow-up must not cancel a scheduled step of another flow.
      const { data: pending, error: pendingError } = await db
        .from('automation_pending_executions')
        .select('id')
        .eq('account_id', c.account_id)
        .eq('contact_id', c.contact_id)
        .in('status', ['pending', 'running'])
        .limit(1)
        .maybeSingle()
      if (pendingError || pending) continue
      // A payment flow added after an older Yape/Plin run has no saved wait.
      // Do not replace the student's payment decision with general courses.
      if (!textFallback && /activ(?:a|ar).*promo/i.test(customer.content_text ?? '')) {
        const paymentRunIds = [...new Set((recentRuns ?? [])
          .filter(run => run.status !== 'failed' && Date.parse(run.created_at) >= Date.parse(customer.created_at))
          .map(run => run.automation_id))]
        if (paymentRunIds.length) {
          const { data: paymentFlows, error: paymentError } = await db.from('automations')
            .select('id,name').eq('account_id', c.account_id).in('id', paymentRunIds)
          if (paymentError) continue
          if (paymentFlows?.some(flow => flow.name === 'YAPE O PLIN')) continue
        }
      }
      const config = await loadAiConfig(db, c.account_id)
      if (!config || !config.autoReplyEnabled) continue

      const contextMessages = await buildConversationContext(db, c.id, 5)
      // A block can send five outgoing messages in a row. Retain the actual
      // latest student choice even when it fell outside that short window.
      const messages = customer.content_text && !contextMessages.some(m=>m.role==='user'&&m.content===customer.content_text)
        ? [{role:'user' as const,content:customer.content_text},...contextMessages] : contextMessages
      let storedArea = c.ai_handoff_area
      if (!storedArea && c.assigned_agent_id) {
        const { data: adviser } = await db.from('profiles').select('area')
          .eq('account_id',c.account_id).eq('user_id',c.assigned_agent_id).maybeSingle()
        storedArea = adviser?.area
      }
      const area = idleFollowupArea(messages, storedArea)
      if (!textFallback && area === 'fidelizacion') {
        const claim = await claimFollowup(db, c)
        if (!claim) continue
        // A resolved support answer needs no sales follow-up or new handoff.
        if (!c.ai_handed_off_at && !promisedHumanSupport(messages)
          && !canFollowUpAfterLastMessage(last.sender_type,last.content_text)) continue
        // A case already promised to fidelity stays with that team. Do not
        // launch sales or assign a second adviser after another silence.
        if (c.ai_handoff_area === 'FIDELIZACION' && c.ai_handed_off_at) continue
        const {agentId} = await routeConversationToArea(db,c.account_id,c.id,'fidelizacion')
        await db.from('conversations').update({ ai_handed_off_at:new Date().toISOString(),
          ai_handoff_summary:buildHandoffSummary({messages,replyCount:0}) }).eq('id',c.id).eq('account_id',c.account_id)
        await engineSendText({accountId:c.account_id,userId:c.user_id,conversationId:c.id,
          contactId:c.contact_id,text:buildHandoffNotice({area:'fidelizacion',agentConnected:Boolean(agentId)}),aiGenerated:true})
        launched++
        continue
      }
      if (!textFallback && recentRuns?.length) {
        const {data: runAutomations,error: runAutomationsError} = await db.from('automations')
          .select('id,name').eq('account_id',c.account_id)
          .in('id',[...new Set(recentRuns.map(run => run.automation_id))])
        if (runAutomationsError) continue
        if (latestCourseSequenceFinished(recentRuns,runAutomations ?? [])) {
          await claimFollowup(db,c)
          continue
        }
      }
      let candidates = !textFallback && messages.length > 0
        ? await findCandidateAutomations(db, c.account_id, messages, 3)
        : []
      candidates = candidates.filter(candidate => !completedMessageOwners.has(candidate.id))
      const customerText = customer.content_text ?? ''
      const focusedCourse=conversationCourse(messages)
      // A failed block is a saved interruption, not permission to choose a
      // different stage of the same course. Preserve its position for review.
      if(focusedCourse && recentRuns?.[0]?.status==='failed') candidates=[]
      if (!textFallback && !focusedCourse && (candidates.length === 0 || /\b(curso|cursos|promo|promoci[oó]n)\b/i.test(customerText) && !courseKey(customerText))) {
        const { data: general } = await db.from('automations')
          .select('id, name, trigger_config')
          .eq('account_id', c.account_id)
          .eq('is_active', true)
          .eq('name', 'CURSOS GENERALES')
          .limit(1)
          .maybeSingle()
        if (general && !completedMessageOwners.has(general.id) && (general.trigger_config as Record<string, unknown> | null)?.internal_only !== true) {
          candidates = [{ id: general.id, name: general.name }]
        }
      }
      if (last.sender_type === 'bot' && candidates.length > 0) {
        // Continue with an unused relevant block; never restart a block
        // already sent for this customer request.
        const { data: priorRuns, error: logError } = await db
          .from('automation_logs')
          .select('automation_id')
          .eq('account_id', c.account_id)
          .eq('contact_id', c.contact_id)
          .in('automation_id', candidates.map(candidate => candidate.id))
          .gte('created_at', customer.created_at)
          .limit(3)
        if (logError) continue
        const used = new Set((priorRuns ?? []).map(run => run.automation_id))
        candidates = candidates.filter(candidate => !used.has(candidate.id))
      }
      const claim = await claimFollowup(db, c)
      if (!claim) continue

      // Sales must use a saved automation, not repeatedly ask which area.
      // No available block is safer than restarting one already delivered.
      if (!textFallback && candidates.length === 0) {
        if(focusedCourse && recentRuns?.[0]?.status==='failed') {
          const {agentId}=await routeConversationToArea(db,c.account_id,c.id,'ventas')
          await db.from('conversations').update({ai_handed_off_at:new Date().toISOString(),
            ai_handoff_area:'VENTAS',ai_handoff_summary:`Continuar ${focusedCourse} desde el bloque interrumpido; no reiniciar ni enviar cursos generales.\n${buildHandoffSummary({messages,replyCount:0})}`}).eq('id',c.id).eq('account_id',c.account_id)
          await engineSendText({accountId:c.account_id,userId:c.user_id,conversationId:c.id,contactId:c.contact_id,
            text:`Seguimos con tu consulta de ${focusedCourse}. ${buildHandoffNotice({area:'ventas',agentConnected:Boolean(agentId)})}`,aiGenerated:true})
          launched++
        }
        continue
      }

      try {
        if (textFallback) {
          await engineSendText({ accountId:c.account_id, userId:c.user_id,
            conversationId:c.id, contactId:c.contact_id, text:IDLE_FOLLOWUP_TEXT, aiGenerated:true })
          launched++
        } else if (candidates.length > 0) {
          const ok = await runAutomationById({
            accountId: c.account_id,
            automationId: candidates[0].id,
            contactId: c.contact_id,
            conversationId: c.id,
            messageText: '',
          })
          if (ok) launched++
        }
      } catch (err) {
        // Keep the claim on failure too: retrying every ten minutes without
        // another customer message creates an endless delivery-error loop.
        console.error('[followup] failed to send idle follow-up:', err)
      }
    }
  } catch (err) {
    console.error('[followup] failed:', err)
  }
  return launched
}

async function claimFollowup(
  db: ReturnType<typeof supabaseAdmin>,
  conversation: {
    id: string
    last_message_at: string
    followup_sent_at: string | null
  },
): Promise<string | null> {
  const claimedAt = new Date().toISOString()
  let query = db
    .from('conversations')
    .update({ followup_sent_at: claimedAt })
    .eq('id', conversation.id)
    .eq('last_message_at', conversation.last_message_at)

  query = conversation.followup_sent_at
    ? query.eq('followup_sent_at', conversation.followup_sent_at)
    : query.is('followup_sent_at', null)

  const { data, error } = await query.select('id').maybeSingle()
  if (error) {
    console.error('[followup] failed to claim idle follow-up:', error)
    return null
  }
  return data ? claimedAt : null
}
