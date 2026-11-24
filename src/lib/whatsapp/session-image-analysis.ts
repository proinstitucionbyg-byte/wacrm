import{automationTestSession}from'@/lib/automations/test-session';
import type{SupabaseClient}from'@supabase/supabase-js';
import{analyzeInboundImage}from'@/lib/ai/analyze-image';
import{logAiUsage}from'@/lib/ai/usage';
import{startEnrollmentSequence}from'@/lib/matriculas/sequence';
import{collectConversationEnrollments}from'@/lib/matriculas/collect';
import{SESSION_MEDIA_BUCKET}from'./session-received-media';
/** Called after private storage succeeds. Replays cannot recreate reviews or validate a payment. */
export async function processSessionImage(db:SupabaseClient,account:string,id:string){
 const row=await db.from('messages').select('id,conversation_id,image_analysis,media_url,content_text,conversations!inner(account_id)').eq('id',id).eq('conversations.account_id',account).eq('sender_type','customer').eq('content_type','image').maybeSingle();
 if(row.error)throw row.error;const message=row.data;if(!message||message.image_analysis)return;
 if(message.media_url!=='/api/whatsapp/session-media/'+id)return;
 const file=await db.storage.from(SESSION_MEDIA_BUCKET).download(account+'/'+id);if(file.error||!file.data)throw file.error??Error('Private image unavailable');
 const result=await analyzeInboundImage({db,accountId:account,conversationId:message.conversation_id,media:{buffer:Buffer.from(await file.data.arrayBuffer()),contentType:file.data.type}});
 const saved=await db.from('messages').update({image_analysis:result.analysis,...(!message.content_text||message.content_text.startsWith('[Imagen recibida;')?{content_text:'[Imagen recibida en el CRM; revisión pendiente]'}:{})}).eq('id',id).eq('conversation_id',message.conversation_id).is('image_analysis',null).select('id');
 if(saved.error)throw saved.error;if(!saved.data?.length)return;
 if(result.usage)await logAiUsage(db,{accountId:account,conversationId:message.conversation_id,mode:'image_analysis',provider:result.provider??'openai',model:result.model??'unknown',usage:result.usage});
 if(result.analysis.category==='payment_receipt'){
  const review=await db.from('payment_reviews').select('id').eq('account_id',account).eq('message_id',id).maybeSingle();if(review.error)throw review.error;
  if(review.data)await startEnrollmentSequence(db,account,review.data.id,'receipt');
 }
 const test=automationTestSession(account,message.conversation_id);
 if(test){
  let q=db.from('enrollment_drafts').select('id').eq('account_id',account).eq('conversation_id',message.conversation_id).eq('status','collecting');
  if(test.reviewIds.length)q=q.not('review_id','in','('+test.reviewIds.join(',')+')');
  const drafts=await q;if(drafts.error)throw drafts.error;
  if(drafts.data?.length===1)await collectConversationEnrollments(db,account,message.conversation_id,drafts.data[0].id);
 }else await collectConversationEnrollments(db,account,message.conversation_id);
}
