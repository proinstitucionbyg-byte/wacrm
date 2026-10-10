import type { SupabaseClient } from '@supabase/supabase-js';
import { runAutomationById } from '@/lib/automations/engine';
export function billingDay(startDate: string): 15 | 30 {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || new Date(startDate).toISOString().slice(0,10)!==startDate) throw Error('INICIO INVALIDO');
  const day=Number(startDate.slice(8));
  return day>=10&&day<=25 ? 15 : 30;
}
/** Reservations prevent webhook/document retries from duplicating a sequence. Failed sends remain for review. */
export async function startEnrollmentSequence(db:SupabaseClient, accountId:string, sourceId:string, stage:'receipt'|'final') {
  const table=stage==='receipt'?'payment_reviews':'enrollment_drafts';
  const {data:source,error}=await db.from(table).select('*').eq('id',sourceId).eq('account_id',accountId).maybeSingle();
  if(error)throw error;
  if(!source?.conversation_id)return;
  let paymentDay:15|30|undefined;
  if(stage==='final'){
    if(source.status!=='registered')return;
    const {data:review,error:reviewError}=await db.from('payment_reviews').select('status').eq('id',source.review_id).eq('account_id',accountId).maybeSingle();
    if(reviewError)throw reviewError;
    if(review?.status!=='validated')return;
    const {data:deliveries,error:deliveryError}=await db.from('enrollment_document_deliveries').select('kind,status').eq('enrollment_id',sourceId).eq('account_id',accountId);
    if(deliveryError)throw deliveryError;
    if(!['BOLETA','FICHA','CRONOGRAMA'].every(kind=>deliveries?.some(item=>item.kind===kind&&item.status==='sent')))return;
    paymentDay=billingDay(source.data.start_date);
  } else if(source.status==='rejected')return;
  const {data:automations,error:automationError}=await db.from('automations').select('id,trigger_config').eq('account_id',accountId).eq('is_active',true).contains('trigger_config',{internal_event:stage==='receipt'?'receipt_received':'documents_sent'});
  if(automationError)throw automationError;
  const matches=(automations??[]).filter(a=>stage==='receipt'||a.trigger_config.billing_day===paymentDay);
  if(matches.length!==1)throw Error('LA SECUENCIA NECESITA UNA AUTOMATIZACION UNICA CONFIGURADA');
  const {data:conversation,error:convError}=await db.from('conversations').select('contact_id').eq('id',source.conversation_id).eq('account_id',accountId).maybeSingle();
  if(convError)throw convError;
  if(!conversation?.contact_id)return;
  const {data:run,error:reserveError}=await db.from('enrollment_sequence_runs').insert({account_id:accountId,source_id:sourceId,stage,conversation_id:source.conversation_id,automation_id:matches[0].id,...(stage==='final'?{welcome_due_at:new Date(Date.now()+2*60*60*1000).toISOString()}: {})}).select('id').single();
  if(reserveError?.code==='23505')return;
  if(reserveError||!run)throw reserveError??Error('NO SE PUDO RESERVAR LA SECUENCIA');
  const launched=await runAutomationById({accountId,automationId:matches[0].id,contactId:conversation.contact_id,conversationId:source.conversation_id,sequenceId:run.id});
  const {error:saveError}=await db.from('enrollment_sequence_runs').update({status:launched?'started':'review',error:launched?null:'REVISAR EL CHAT ANTES DE REINTENTAR LA SECUENCIA'}).eq('id',run.id).eq('account_id',accountId);
  if(saveError)throw saveError;
}
