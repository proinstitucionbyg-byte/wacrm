import type { SupabaseClient } from '@supabase/supabase-js'
import { courseKey } from '@/lib/matriculas/calendar'

export interface CourseCheckpoint {
  pending_ids: string[]
  captured_at: string
}
interface WaitRow {
  id: string
  automation_id: string
  status: string
  run_at: string
  log_id?: string
  context: Record<string, unknown> | null
}
export function isCourseDetour(flow: { trigger_config?: unknown }): boolean {
  return (flow.trigger_config as Record<string, unknown> | null)?.course_detour === true
}
export function isCourseContinue(flow: { trigger_config?: unknown }): boolean {
  return (flow.trigger_config as Record<string, unknown> | null)?.course_continue === true
}
export function isSavedCourseName(name: string): boolean {
  return Boolean(courseKey(name.replace(/\basistente a\b/gi, 'asistente administrativo')
    .replace(/\binicial\b/gi, 'educacion inicial').replace(/\brrhh\b/gi, 'recursos humanos')))
}

/** Pause actual saved positions, including a linked parent and its child. */
export async function captureCourseCheckpoint(db: SupabaseClient, account: string, contact: string, chat: string): Promise<{ checkpoint?: CourseCheckpoint; busy: boolean }> {
  const { data, error } = await db.from('automation_pending_executions')
    .select('id,automation_id,status,run_at,log_id,context').eq('account_id', account).eq('contact_id', contact)
    .in('status', ['pending', 'running']).order('created_at', { ascending: false }).limit(100)
  if (error) throw error
  const rows = ((data ?? []) as WaitRow[]).filter(row => row.context?.conversation_id === chat
    && !row.context?.enrollment_sequence_id && !row.context?.manual_agent_id)
  const inherited = rows.find(row => row.context?.course_checkpoint)?.context?.course_checkpoint as CourseCheckpoint | undefined
  const { data: flows, error: flowError } = rows.length ? await db.from('automations').select('id,name,trigger_config')
    .eq('account_id', account).in('id', [...new Set(rows.map(row => row.automation_id))]) : { data: [], error: null }
  if (flowError) throw flowError
  // A material-answer route can contain the course name too. Its inherited
  // checkpoint owns the actual course; capturing the route itself loses it
  // when the customer asks for another material before the route finishes.
  const courses = new Set((flows ?? []).filter(flow => !isCourseDetour(flow)
    && (isSavedCourseName(flow.name) || flow.name === 'YAPE O PLIN'
      || flow.trigger_config?.payment_followup === true)).map(flow => flow.id))
  const courseRows = rows.filter(row => courses.has(row.automation_id))
  // Generic button automations may not mention the course in their name.
  // Keep a parent only when it is waiting for this actual saved child log.
  for (let depth = 0; depth < rows.length; depth++) {
    const parents = rows.filter(row => !courseRows.includes(row)
      && typeof row.context?.await_child_log_id === 'string'
      && courseRows.some(child => child.log_id === row.context?.await_child_log_id))
    if (!parents.length) break
    courseRows.push(...parents)
  }
  if (courseRows.some(row => row.status === 'running')) return { busy: true }
  if (!courseRows.length) return { checkpoint: inherited, busy: false }
  const ids = courseRows.map(row => row.id)
  const { data: paused, error: pauseError } = await db.from('automation_pending_executions')
    .update({ status: 'cancelled' }).eq('account_id', account).eq('contact_id', contact)
    .in('id', ids).eq('status', 'pending').select('id')
  if (pauseError) throw pauseError
  if (paused?.length !== ids.length) {
    // A cron claim won the race. Put back only the rows this call paused.
    if (paused?.length) {
      const { error: rollbackError } = await db.from('automation_pending_executions').update({ status: 'pending' })
        .eq('account_id', account).eq('contact_id', contact).in('id', paused.map(row => row.id)).eq('status', 'cancelled')
      if (rollbackError) throw rollbackError
    }
    return { busy: true }
  }
  return { checkpoint: { pending_ids: ids, captured_at: new Date().toISOString() }, busy: false }
}

export async function currentCourseCheckpoint(db: SupabaseClient, account: string, contact: string, chat: string): Promise<CourseCheckpoint | undefined> {
  const { data, error } = await db.from('automation_pending_executions').select('context')
    .eq('account_id', account).eq('contact_id', contact).in('status', ['pending', 'running'])
    .order('created_at', { ascending: false }).limit(100)
  if (error) throw error
  return data?.find(row => row.context?.conversation_id === chat && row.context?.course_checkpoint)?.context?.course_checkpoint
}

/** Restore exact rows, never a guessed course or an earlier numbered block. */
export async function restoreCourseCheckpoint(db: SupabaseClient, args: {
  account: string; contact: string; chat: string; checkpoint?: CourseCheckpoint;
  automatic: boolean; ignorePendingId?: string; now?: number;
}): Promise<'restored' | 'missing' | 'superseded' | 'human'> {
  const { account, contact, chat, checkpoint } = args
  if (!checkpoint?.pending_ids.length || !Number.isFinite(Date.parse(checkpoint.captured_at))) return 'missing'
  const now = args.now ?? Date.now()
  const { data: conv, error: convError } = await db.from('conversations').select('automation_enabled,last_human_message_at')
    .eq('id', chat).eq('account_id', account).eq('contact_id', contact).maybeSingle()
  if (convError) throw convError
  if (!conv || conv.automation_enabled === false || Date.parse(conv.last_human_message_at ?? '') > Date.parse(checkpoint.captured_at)) return 'human'
  if (args.automatic) {
    const { data: newer, error } = await db.from('messages').select('id').eq('conversation_id', chat)
      .eq('sender_type', 'customer').gt('created_at', checkpoint.captured_at).limit(1).maybeSingle()
    if (error) throw error
    if (newer) return 'superseded'
  }
  const { data: payments, error: paymentError } = await db.from('payment_reviews').select('id')
    .eq('account_id', account).eq('contact_id', contact).gte('created_at', checkpoint.captured_at).limit(1)
  if (paymentError) throw paymentError
  if (payments?.length) return 'superseded'
  const { data: active, error: activeError } = await db.from('automation_pending_executions')
    .select('id,automation_id,context').eq('account_id', account).eq('contact_id', contact).in('status', ['pending', 'running']).limit(100)
  if (activeError) throw activeError
  const other = (active ?? []).filter(row => row.id !== args.ignorePendingId && row.context?.conversation_id === chat)
  if (other.length) return 'superseded'
  const { data: saved, error: savedError } = await db.from('automation_pending_executions')
    .select('id,automation_id,status,run_at,context').eq('account_id', account).eq('contact_id', contact)
    .in('id', checkpoint.pending_ids).eq('status', 'cancelled')
  if (savedError) throw savedError
  const rows = (saved ?? []) as WaitRow[]
  if (rows.length !== checkpoint.pending_ids.length || rows.some(row => row.context?.conversation_id !== chat)) return 'missing'
  const { data: flows, error: flowError } = await db.from('automations').select('id,is_active')
    .eq('account_id', account).in('id', [...new Set(rows.map(row => row.automation_id))])
  if (flowError) throw flowError
  if (rows.some(row => !flows?.some(flow => flow.id === row.automation_id && flow.is_active))) return 'superseded'
  // CAS the whole group before setting its due dates; the cron must not see
  // half a linked chain as runnable. running is also excluded from cron claims.
  const { data: claimed, error: claimError } = await db.from('automation_pending_executions')
    .update({ status: 'running' }).eq('account_id', account).eq('contact_id', contact)
    .in('id', checkpoint.pending_ids).eq('status', 'cancelled').select('id')
  if (claimError) throw claimError
  if (claimed?.length !== rows.length) {
    if (claimed?.length) await db.from('automation_pending_executions').update({ status: 'cancelled' })
      .eq('account_id', account).eq('contact_id', contact).in('id', claimed.map(row => row.id)).eq('status', 'running')
    return 'superseded'
  }
  try {
    for (const row of rows) {
      const { error } = await db.from('automation_pending_executions').update({
        run_at: new Date(Math.max(now, Date.parse(row.run_at))).toISOString(),
      }).eq('id', row.id).eq('account_id', account).eq('contact_id', contact).eq('status', 'running')
      if (error) throw error
    }
    const { error } = await db.from('automation_pending_executions').update({ status: 'pending' })
      .eq('account_id', account).eq('contact_id', contact).in('id', checkpoint.pending_ids).eq('status', 'running')
    if (error) throw error
  } catch (error) {
    // Preserve the checkpoint if storage is unavailable; do not restart a course.
    await db.from('automation_pending_executions').update({ status: 'cancelled' })
      .eq('account_id', account).eq('contact_id', contact).in('id', checkpoint.pending_ids)
    throw error
  }
  return 'restored'
}
