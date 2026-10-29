import type { SupabaseClient } from '@supabase/supabase-js'
import { enqueueDeferredKeywordOpening } from './deferred-keyword-openings'
import { decideFirstInboundKeywordRouting, hasConfiguredOpeningKeyword, type OpeningKeywordConfig } from './opening-keywords'

const HUMAN_ASSISTANCE_TAG = 'ASESOR URGENTE'
export type FirstInboundDisposition = 'continue' | 'deferred' | 'human'

/** Reuses the same human/deferred gate for Cloud and owner-linked sessions. */
export async function pauseUnknownFirstInboundForHuman(db: SupabaseClient, args: {
  accountId: string
  conversationId: string
  contactId: string
  userId: string
  isFirstInboundMessage: boolean
  channel?: 'cloud' | 'session'
  text: string
  hasConfirmedAdOrigin: boolean
  messageId: string
  receivedAt: string
  contactCreated: boolean
}): Promise<FirstInboundDisposition> {
  const text = args.text.trim()
  if (!args.isFirstInboundMessage) return 'continue'

  const [automationsResult, flowsResult] = await Promise.all([
    db.from('automations').select('trigger_config').eq('account_id', args.accountId)
      .eq('trigger_type', 'keyword_match').eq('is_active', true),
    db.from('flows').select('trigger_config').eq('account_id', args.accountId)
      .eq('trigger_type', 'keyword').eq('status', 'active'),
  ])
  const lookupFailed = !!automationsResult.error || !!flowsResult.error
  if (automationsResult.error) console.error('[inbound] initial keyword automation lookup failed:', automationsResult.error)
  if (flowsResult.error) console.error('[inbound] initial keyword flow lookup failed:', flowsResult.error)
  const keywordMatch = !lookupFailed && hasConfiguredOpeningKeyword(
    text,
    (automationsResult.data ?? []).map((row: { trigger_config: OpeningKeywordConfig | null }) => row.trigger_config),
    (flowsResult.data ?? []).map((row: { trigger_config: OpeningKeywordConfig | null }) => row.trigger_config),
  )
  const decision = decideFirstInboundKeywordRouting({
    firstInbound: true,
    keywordMatch,
    lookupSucceeded: !lookupFailed,
    // WhatsApp Web has no Meta click-to-WhatsApp signal or Cloud billing
    // window to wait for. A configured opening keyword can enter the shared
    // CRM branches directly on that channel; unknown first contacts remain
    // assigned to a person as before.
    adOriginConfirmed: args.hasConfirmedAdOrigin || args.channel === 'session',
  })
  if (decision === 'continue') return 'continue'
  if (decision === 'wait_for_meta') {
    try {
      await enqueueDeferredKeywordOpening(db, {
        account_id: args.accountId,
        user_id: args.userId,
        contact_id: args.contactId,
        conversation_id: args.conversationId,
        meta_message_id: args.messageId,
        message_text: text,
        received_at: args.receivedAt,
        contact_created: args.contactCreated,
      })
      return 'deferred'
    } catch (error) {
      console.error('[inbound] could not schedule the keyword recheck:', error)
    }
  }

  const disabledAt = new Date().toISOString()
  const { error: pauseError } = await db.from('conversations')
    .update({ ai_enabled: false, automation_enabled: false, automation_disabled_at: disabledAt })
    .eq('id', args.conversationId).eq('account_id', args.accountId)
  if (pauseError) console.error('[inbound] could not persist unknown-inbound pause:', pauseError)

  try {
    const { data: existingTag, error: tagLookupError } = await db.from('tags').select('id')
      .eq('account_id', args.accountId).eq('name', HUMAN_ASSISTANCE_TAG).limit(1).maybeSingle()
    if (tagLookupError) throw tagLookupError
    let tagId = existingTag?.id as string | undefined
    if (!tagId) {
      const { data: createdTag, error: createTagError } = await db.from('tags').insert({
        user_id: args.userId, account_id: args.accountId, name: HUMAN_ASSISTANCE_TAG,
        color: '#f97316', kind: 'access', audience: { users: [], areas: ['VENTAS'], roles: ['owner', 'admin', 'coordinator'] },
      }).select('id').single()
      if (createTagError) throw createTagError
      tagId = createdTag?.id as string | undefined
    }
    if (!tagId) throw new Error('No se pudo resolver la etiqueta de asistencia humana')
    const { error: attachError } = await db.from('contact_tags').upsert(
      { contact_id: args.contactId, tag_id: tagId }, { onConflict: 'contact_id,tag_id', ignoreDuplicates: true },
    )
    if (attachError) throw attachError
  } catch (error) {
    console.error('[inbound] could not tag unknown first inbound:', error)
  }
  return 'human'
}
