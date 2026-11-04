import type {SupabaseClient} from '@supabase/supabase-js';
import {isConfirmedClickToWhatsAppReferral} from './billing';

export async function pendingSupportWait(db:SupabaseClient,accountId:string,conversationId:string):Promise<boolean>{
 const {data,error}=await db.from('whatsapp_support_waits').select('id').eq('account_id',accountId).eq('conversation_id',conversationId).in('status',['pending','running']).limit(1).maybeSingle();
 if(error)throw Error('No se pudo verificar la espera de Meta; no se cambiará de número.');
 return !!data;
}
export async function enqueueSupportWait(db:SupabaseClient,args:{accountId:string;conversationId:string;messageId:string;isFirstInboundMessage?:boolean;contactCreated?:boolean}){
 const {data,error}=await db.rpc('enqueue_whatsapp_support_wait',{p_account_id:args.accountId,p_conversation_id:args.conversationId,p_provider_id:args.messageId,p_first_inbound:args.isFirstInboundMessage===true,p_contact_created:args.contactCreated===true});
 if(error||data?.waiting!==true)throw Error('No se pudo conservar la espera de tres minutos.');
}

type Wait={id:string;account_id:string;conversation_id:string;source_message_id:string;first_inbound:boolean;contact_created:boolean;run_at:string};
export async function drainSupportWaits(db:SupabaseClient){
 const {data,error}=await db.rpc('claim_whatsapp_support_waits');
 if(error)throw Error('No se pudo revisar la espera de Meta.');
 const rows=(data??[]) as Wait[];
 await Promise.allSettled(rows.map(async row=>{
  const finish=async(status:'done'|'cancelled'|'needs_review',result:string)=>{
   const saved=await db.from('whatsapp_support_waits').update({status,result,completed_at:new Date().toISOString()}).eq('id',row.id).eq('status','running');
   if(saved.error)throw Error('No se confirmó el cierre de la espera.');
   if(status!=='needs_review'){
    const cleared=await db.from('conversations').update({whatsapp_support_wait_until:null}).eq('id',row.conversation_id).eq('account_id',row.account_id).eq('whatsapp_support_wait_until',row.run_at);
    if(cleared.error)throw Error('No se pudo cerrar la verificación del canal.');
   }
  };
  try{
   const source=await db.from('messages').select('message_id,content_text,source_referral,created_at,interactive_reply_id').eq('id',row.source_message_id).eq('conversation_id',row.conversation_id).eq('sender_type','customer').maybeSingle();
   const conv=await db.from('conversations').select('contact_id,user_id,ai_enabled,automation_enabled,last_human_message_at,first_ad_referral,whatsapp_support_line_key').eq('id',row.conversation_id).eq('account_id',row.account_id).maybeSingle();
   if(source.error||conv.error||!source.data||!conv.data)throw Error('Source unavailable');
   if(conv.data.automation_enabled===false||conv.data.whatsapp_support_line_key){await finish('cancelled','already_handled_or_paused');return;}
   const answered=await db.from('messages').select('id').eq('conversation_id',row.conversation_id).in('sender_type',['bot','agent']).in('status',['sent','delivered','read']).gte('created_at',source.data.created_at).limit(1).maybeSingle();
   if(answered.error)throw Error('Reply check unavailable');
   if(answered.data){await finish('cancelled','already_answered');return;}
   const args={db,channel:'cloud' as const,accountId:row.account_id,userId:conv.data.user_id,contactId:conv.data.contact_id,conversationId:row.conversation_id,messageId:source.data.message_id,
    contentText:source.data.content_text,inboundAt:source.data.created_at,isFirstInboundMessage:row.first_inbound,contactCreated:row.contact_created,interactiveReplyId:source.data.interactive_reply_id,
    hasConfirmedAdOrigin:isConfirmedClickToWhatsAppReferral(conv.data.first_ad_referral)||isConfirmedClickToWhatsAppReferral(source.data.source_referral),conversation:conv.data};
   if(args.hasConfirmedAdOrigin){const {dispatchInboundThroughCrm}=await import('./inbound-dispatch');await dispatchInboundThroughCrm(args);await finish('done','campaign_confirmed_preserved');}
   else{const {routeCloudSupportOpening}=await import('./cloud-support');const handled=await routeCloudSupportOpening(db,{...args,metaWaitExpired:true});await finish(handled?'done':'cancelled',handled?'support_after_three_minutes':'commercial_continuity_preserved');}
  }catch{await finish('needs_review','classification_or_delivery_requires_review');}
 }));
 return rows.length;
}
