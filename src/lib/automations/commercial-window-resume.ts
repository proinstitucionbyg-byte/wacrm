import type {SupabaseClient} from '@supabase/supabase-js'
import {COMMERCIAL_SCHEDULE_VERSION} from './commercial-schedule'
import {HUMAN_PAUSE_MS} from '@/lib/ai/human-pause'

/** Only window-held commercial rows may resume on a genuine new inbound.
 * Manual pauses, human handoffs, payment cases and other versions stay intact. */
export async function resumeCommercialWindow(db:SupabaseClient,args:{account:string;contact:string;chat:string;inboundAt:string}):Promise<void> {
  const inbound=Date.parse(args.inboundAt)
  if(!Number.isFinite(inbound) || inbound>Date.now()+60_000 || Date.now()-inbound>=24*3600_000)return
  const {data:rows,error}=await db.from('automation_pending_executions').select('id,context')
    .eq('account_id',args.account).eq('contact_id',args.contact).eq('status','paused')
    .contains('context',{conversation_id:args.chat,commercial_window_hold:true,
      commercial_schedule:{version:COMMERCIAL_SCHEDULE_VERSION}})
  if(error)throw error
  const eligible=(rows??[]).filter(row=>inbound>Date.parse(row.context.commercial_schedule.last_customer_at))
  if(!eligible.length)return
  const {data:chat,error:chatError}=await db.from('conversations').select('automation_enabled,last_human_message_at')
    .eq('id',args.chat).eq('account_id',args.account).eq('contact_id',args.contact).maybeSingle()
  if(chatError)throw chatError
  if(!chat || chat.automation_enabled!==true || Date.now()-Date.parse(chat.last_human_message_at??'')<HUMAN_PAUSE_MS)return
  const {data:payment,error:payError}=await db.from('payment_reviews').select('id')
    .eq('account_id',args.account).eq('conversation_id',args.chat).in('status',['pending','validated']).limit(1).maybeSingle()
  if(payError)throw payError
  if(payment)return
  // Only one journey can own this chat; never revive two ambiguous holds.
  if(eligible.length!==1)return
  const row=eligible[0]
  const {data:active,error:activeError}=await db.from('automation_pending_executions').select('id')
    .eq('account_id',args.account).eq('contact_id',args.contact).in('status',['pending','running'])
    .contains('context',{conversation_id:args.chat}).limit(1)
  if(activeError)throw activeError
  if(active?.length)return
  const {error:updateError}=await db.from('automation_pending_executions').update({status:'pending',
    run_at:new Date(Date.now()+20*60_000).toISOString(),context:{...row.context,commercial_window_hold:false,
      commercial_deferred_reason:undefined,commercial_remaining_step_ids:undefined}})
    .eq('id',row.id).eq('account_id',args.account).eq('contact_id',args.contact).eq('status','paused')
    .contains('context',{commercial_window_hold:true})
  if(updateError)throw updateError
}
