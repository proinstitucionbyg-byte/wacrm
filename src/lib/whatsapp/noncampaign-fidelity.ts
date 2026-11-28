import type { SupabaseClient } from '@supabase/supabase-js'
import { isConfirmedClickToWhatsAppReferral } from './billing'
import { enqueueSupportWait } from './cloud-support-wait'
import { routeConversationToArea } from '@/lib/ai/handoff-routing'
import { isSalesInquiry } from '@/lib/sales/attribution'

/** Keep student support separate, without pausing ordinary organic sales leads. */
export async function pauseNoncampaignFidelity(db: SupabaseClient, args: {
  accountId: string; conversationId: string; contactId: string; messageId: string
  hasConfirmedAdOrigin: boolean; channel: 'cloud' | 'session'
  isFirstInboundMessage?: boolean; contactCreated?: boolean; metaWaitExpired?: boolean
  contentText?: string | null; audioTranscript?: string | null
}): Promise<boolean> {
  if (args.hasConfirmedAdOrigin) return false
  const { data, error } = await db.from('conversations')
    .select('first_ad_referral,whatsapp_support_line_key')
    .eq('account_id', args.accountId).eq('id', args.conversationId).single()
  if (error || !data) throw new Error('No se pudo verificar el origen; no se responderá automáticamente.')
  // Keep campaign provenance even after purchase, assignment or a change of phone.
  if (isConfirmedClickToWhatsAppReferral(data.first_ad_referral)) return false
  // A delivered owner-approved commercial campaign also establishes context.
  // Mere list membership does not: require a real accepted outbound message.
  const campaign = await db.from('multichannel_jobs').select('id')
    .eq('account_id', args.accountId).eq('contact_id', args.contactId)
    .eq('mode', 'whatsapp_live').in('status', ['accepted', 'delivered'])
    .not('campaign_id', 'is', null).limit(1).maybeSingle()
  if (campaign.error) throw campaign.error
  if (campaign.data) return false
  if (args.channel === 'cloud' && !data.whatsapp_support_line_key && !args.metaWaitExpired) {
    await enqueueSupportWait(db, args)
    return true
  }
  const tags=await db.from('contact_tags').select('tags!inner(name)').eq('contact_id',args.contactId)
    .eq('tags.account_id',args.accountId)
  if(tags.error)throw tags.error
  const names=((tags.data??[]) as unknown as {tags:{name:string}|{name:string}[]}[])
    .flatMap(row=>Array.isArray(row.tags)?row.tags:[row.tags]).filter(Boolean).map(row=>row.name.toUpperCase())
  const student=names.some(name=>['AREA FIDELIZACION','PAGO VALIDADO','VENTA REALIZADA'].includes(name)||name.includes('MATRICUL'))
  if(!student&&(names.includes('AREA VENTAS')||isSalesInquiry(args.contentText??args.audioTranscript??'',{firstInbound:args.isFirstInboundMessage})))return false
  const paused = await db.from('conversations').update({ ai_enabled: false,
    automation_enabled: false, automation_disabled_at: new Date().toISOString() })
    .eq('account_id', args.accountId).eq('id', args.conversationId)
  if (paused.error) throw paused.error
  await routeConversationToArea(db, args.accountId, args.conversationId, 'fidelizacion')
  const cancelled = await db.from('automation_pending_executions').update({ status: 'cancelled' })
    .eq('account_id', args.accountId).eq('contact_id', args.contactId).eq('status', 'pending')
    .is('context->>enrollment_sequence_id', null).is('context->>manual_agent_id', null)
  if (cancelled.error) throw cancelled.error
  return true
}
