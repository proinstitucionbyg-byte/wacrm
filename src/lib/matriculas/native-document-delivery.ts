import type { SupabaseClient } from '@supabase/supabase-js';
/** A durable queue ID is not a delivery receipt. Never queue a second copy. */
export async function reconcileNativeEnrollmentDocument(db:SupabaseClient,accountId:string,enrollmentId:string,kind:string,messageId:string):Promise<'sent'|'queued'|'review'>{
 const match=/^waweb-job:([0-9a-f-]{36})$/.exec(messageId);if(!match)return 'review';
 const result=await db.from('whatsapp_session_outbound_jobs').select('status,provider_message_id,conversation_id').eq('id',match[1]).eq('account_id',accountId).maybeSingle();if(result.error)throw result.error;
 if(!result.data)return 'review';
 if(['delivered','read'].includes(result.data.status)&&result.data.provider_message_id){
  const saved=await db.from('enrollment_document_deliveries').update({status:'sent',whatsapp_message_id:result.data.provider_message_id,sent_at:new Date().toISOString(),error:null}).eq('account_id',accountId).eq('enrollment_id',enrollmentId).eq('kind',kind).eq('status','sending');if(saved.error)throw saved.error;return 'sent';
 }
 return ['queued','claimed','dispatching','accepted'].includes(result.data.status)?'queued':'review';
}
