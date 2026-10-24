import type { SupabaseClient } from '@supabase/supabase-js'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { dispatchInboundToFlows } from '@/lib/flows/engine'
import { isLikelyAutomatedInbound } from '@/lib/ai/automated-inbound'
import { gateAutomaticWhatsAppConversation } from './billing-runtime'
import { isConfirmedClickToWhatsAppReferral } from './billing'
import { hasConfiguredOpeningKeyword } from './opening-keywords'

export const KEYWORD_OPENING_META_WAIT_MS = 60_000
const QUEUE = 'whatsapp_keyword_openings'

/** Keep subsequent customer messages quiet while a first keyword waits for
 * Meta's delayed referral update. A lookup failure also suppresses this one
 * inbound rather than accidentally disabling or starting another sequence. */
export async function hasPendingDeferredKeywordOpening(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
): Promise<boolean> {
  const { data, error } = await db.from(QUEUE).select('id')
    .eq('account_id', accountId).eq('conversation_id', conversationId)
    .in('status', ['pending', 'running']).limit(1).maybeSingle()
  if (error) {
    console.error('[whatsapp-keyword-opening] pending lookup failed; suppressing inbound:', error.message)
    return true
  }
  return !!data
}

export interface DeferredKeywordOpening {
  id: string
  account_id: string
  user_id: string
  contact_id: string | null
  conversation_id: string | null
  meta_message_id: string
  message_text: string
  received_at: string
  contact_created: boolean
}

export async function enqueueDeferredKeywordOpening(
  db: SupabaseClient,
  args: Omit<DeferredKeywordOpening, 'id'>,
): Promise<void> {
  const { error } = await db.from(QUEUE).upsert({
    ...args,
    run_at: new Date(Date.now() + KEYWORD_OPENING_META_WAIT_MS).toISOString(),
    status: 'pending',
  }, { onConflict: 'account_id,meta_message_id', ignoreDuplicates: true })
  if (error) throw new Error(`No se pudo guardar el inicio diferido: ${error.message}`)
}

async function markQueueRow(
  db: SupabaseClient,
  row: DeferredKeywordOpening,
  status: 'done' | 'failed' | 'cancelled',
  result: string,
  resolution: 'confirmed' | 'por_confirmar' | null = null,
  errorMessage: string | null = null,
) {
  const { error } = await db.from(QUEUE).update({
    status,
    result,
    billing_resolution: resolution,
    error_message: errorMessage,
    completed_at: new Date().toISOString(),
  }).eq('id', row.id).eq('status', 'running')
  if (error) console.error('[whatsapp-keyword-opening] queue update failed:', error.message)
}

async function activeOpeningKeywordMatches(
  db: SupabaseClient,
  accountId: string,
  messageText: string,
): Promise<boolean | null> {
  const [automations, flows] = await Promise.all([
    db.from('automations').select('trigger_config').eq('account_id', accountId)
      .eq('trigger_type', 'keyword_match').eq('is_active', true),
    db.from('flows').select('trigger_config').eq('account_id', accountId)
      .eq('trigger_type', 'keyword').eq('status', 'active'),
  ])
  if (automations.error || flows.error) return null
  return hasConfiguredOpeningKeyword(
    messageText,
    (automations.data ?? []).map((row) => row.trigger_config),
    (flows.data ?? []).map((row) => row.trigger_config),
  )
}

export async function resumeDeferredKeywordOpening(
  db: SupabaseClient,
  row: DeferredKeywordOpening,
): Promise<void> {
  if (!row.conversation_id || !row.contact_id) {
    await markQueueRow(db, row, 'cancelled', 'conversation_or_contact_removed')
    return
  }

  const { data: conversation, error: conversationError } = await db.from('conversations')
    .select('automation_enabled,last_human_message_at,first_ad_referral,first_ad_referral_at')
    .eq('id', row.conversation_id).eq('account_id', row.account_id).maybeSingle()
  if (conversationError || !conversation) {
    await markQueueRow(db, row, 'failed', 'conversation_lookup_failed', null, conversationError?.message ?? 'Conversation not found')
    return
  }
  if (conversation.automation_enabled === false) {
    await markQueueRow(db, row, 'cancelled', 'automation_manually_disabled')
    return
  }
  const lastHumanAt = Date.parse(conversation.last_human_message_at ?? '')
  if (Number.isFinite(lastHumanAt) && lastHumanAt > Date.parse(row.received_at)) {
    await markQueueRow(db, row, 'cancelled', 'adviser_replied_while_waiting')
    return
  }

  const { data: originalMessage, error: originalMessageError } = await db.from('messages')
    .select('id').eq('conversation_id', row.conversation_id).eq('message_id', row.meta_message_id)
    .eq('sender_type', 'customer').maybeSingle()
  if (originalMessageError || !originalMessage) {
    await markQueueRow(db, row, 'failed', 'original_inbound_not_found', null, originalMessageError?.message ?? 'Inbound message not found')
    return
  }
  if (isLikelyAutomatedInbound(row.message_text)) {
    await markQueueRow(db, row, 'cancelled', 'automated_inbound')
    return
  }

  const keywordMatch = await activeOpeningKeywordMatches(db, row.account_id, row.message_text)
  if (keywordMatch === null) {
    await markQueueRow(db, row, 'failed', 'active_keyword_lookup_failed', null, 'No se pudieron releer las palabras configuradas')
    return
  }
  if (!keywordMatch) {
    await gateAutomaticWhatsAppConversation(db, {
      accountId: row.account_id,
      conversationId: row.conversation_id,
      contactId: row.contact_id,
    }).catch((error) => console.error('[whatsapp-keyword-opening] human handoff failed:', error))
    await markQueueRow(db, row, 'cancelled', 'opening_keyword_no_longer_active')
    return
  }

  const referralConfirmed = isConfirmedClickToWhatsAppReferral(conversation.first_ad_referral)
  const keywordOpeningFallback = !referralConfirmed
  const context = {
    message_text: row.message_text,
    conversation_id: row.conversation_id,
    inbound_at: row.received_at,
    ...(keywordOpeningFallback ? { billing_unknown_keyword_fallback: true } : {}),
  }

  let flowConsumed = false
  try {
    const flowResult = await dispatchInboundToFlows({
      accountId: row.account_id,
      userId: row.user_id,
      contactId: row.contact_id,
      conversationId: row.conversation_id,
      message: { kind: 'text', text: row.message_text, meta_message_id: row.meta_message_id },
      isFirstInboundMessage: true,
      billingKeywordFallback: keywordOpeningFallback,
    })
    flowConsumed = flowResult.consumed
  } catch (error) {
    console.error('[whatsapp-keyword-opening] flow start failed:', error)
  }

  let automationMatched = false
  if (!flowConsumed) {
    const triggers = [
      ...(row.contact_created ? ['new_contact_created' as const] : []),
      'first_inbound_message' as const,
      'new_message_received' as const,
      'keyword_match' as const,
    ]
    for (const triggerType of triggers) {
      automationMatched = await runAutomationsForTrigger({
        accountId: row.account_id,
        triggerType,
        contactId: row.contact_id,
        context,
      }) || automationMatched
    }
  }

  await markQueueRow(
    db,
    row,
    'done',
    flowConsumed ? 'flow_started' : automationMatched ? 'automation_started' : 'no_matching_flow_or_automation',
    referralConfirmed ? 'confirmed' : 'por_confirmar',
  )
}

export async function drainDeferredKeywordOpenings(
  db: SupabaseClient,
  limit = 30,
): Promise<number> {
  const stale = new Date(Date.now() - 15 * 60_000).toISOString()
  const { error: staleError } = await db.from(QUEUE).update({ status: 'pending', claimed_at: null })
    .eq('status', 'running').lt('claimed_at', stale)
  if (staleError) {
    console.error('[whatsapp-keyword-opening] stale-claim reset failed:', staleError.message)
    return 0
  }

  const { data: due, error } = await db.from(QUEUE).select('*')
    .eq('status', 'pending').lte('run_at', new Date().toISOString())
    .order('run_at', { ascending: true }).limit(limit)
  if (error) {
    console.error('[whatsapp-keyword-opening] due queue lookup failed:', error.message)
    return 0
  }

  let processed = 0
  for (const raw of due ?? []) {
    const { data: claimed, error: claimError } = await db.from(QUEUE).update({
      status: 'running', claimed_at: new Date().toISOString(),
    }).eq('id', raw.id).eq('status', 'pending').select('*').maybeSingle()
    if (claimError || !claimed) continue
    const row = claimed as DeferredKeywordOpening
    try {
      await resumeDeferredKeywordOpening(db, row)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      console.error('[whatsapp-keyword-opening] resume failed:', detail)
      await markQueueRow(db, row, 'failed', 'resume_failed', null, detail)
    }
    processed++
  }
  return processed
}
