import {randomUUID} from 'node:crypto';
import type {SupabaseClient} from '@supabase/supabase-js';
import {isConfirmedClickToWhatsAppReferral} from './billing';
import {latestSessionOrigin} from './session-origin';
export async function continuationContext(db:SupabaseClient,accountId:string,conversationId:string){
 const [chat,source,policy,lines,linked]=await Promise.all([
 db.from('conversations').select('id,first_ad_referral,whatsapp_support_line_key').eq('account_id',accountId).eq('id',conversationId).maybeSingle(),
 db.from('messages').select('id,sender_type,created_at,source_referral,whatsapp_session_line_key').eq('conversation_id',conversationId).eq('sender_type','customer').order('created_at',{ascending:false}).order('id',{ascending:false}).limit(1).maybeSingle(),
 db.from('whatsapp_support_routes').select('enabled,line_order').eq('account_id',accountId).maybeSingle(),
 db.from('multichannel_whatsapp_session_lines').select('line_key,linked_phone,paused,support_ready_at').eq('account_id',accountId),
 db.from('messages').select('id,sender_type,created_at,whatsapp_session_line_key').eq('conversation_id',conversationId).not('whatsapp_session_line_key','is',null).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(1).maybeSingle()]);
 if(chat.error||source.error||policy.error||lines.error||linked.error)throw Error('No se pudo comprobar el chat y sus numeros.');
 if(!chat.data)throw Error('Chat no disponible.');
 const ordered=(lines.data??[]).filter(l=>l.linked_phone);
 ordered.sort((a,b)=>Number(b.linked_phone==='51933691668')-Number(a.linked_phone==='51933691668'));
 return {enabled:policy.data?.enabled===true,sourceId:source.data?.id??null,currentLine:latestSessionOrigin([...(source.data?[source.data]:[]),...(linked.data?[linked.data]:[])],chat.data.whatsapp_support_line_key),cloud:!!source.data&&!source.data.whatsapp_session_line_key,adOrigin:isConfirmedClickToWhatsAppReferral(chat.data.first_ad_referral)||isConfirmedClickToWhatsAppReferral(source.data?.source_referral),lines:ordered.map(l=>({...l,ready:!l.paused&&Date.now()-Date.parse(l.support_ready_at??'')>=0&&Date.now()-Date.parse(l.support_ready_at??'')<20000}))};
}
export class ContinuationNotQueued extends Error {}
export async function continueManually(db:SupabaseClient,args:{accountId:string;conversationId:string;senderId:string;sourceId:string|null;lineKey:string;phone:string;text:string;requestId:string}){
 const r=await db.rpc('continue_whatsapp_conversation',{p_account:args.accountId,p_conversation:args.conversationId,p_sender:args.senderId,p_source:args.sourceId,p_line:args.lineKey,p_phone:args.phone,p_body:args.text,p_request:args.requestId});
 if(r.error){const message=r.error.code==='40001'?'Llegó otro mensaje. Actualiza el chat antes de continuar.':'No se pudo continuar por ese WhatsApp. No se enviará por Meta.';if(['40001','42501','22023'].includes(r.error.code??''))throw new ContinuationNotQueued(message);throw Error(message);}
 if(!r.data?.message_row_id||!r.data?.message_id)throw Error('Falta confirmar el envío; consulta el chat antes de repetir.');return r.data;
}

export async function routeOrganicManualReply(db:SupabaseClient,args:{accountId:string;conversationId:string;senderId:string;text:string;messageType:string}){
 const context=await continuationContext(db,args.accountId,args.conversationId);
 if(!context.enabled||!context.cloud||context.adOrigin)return null;
 if(args.messageType!=='text')throw Error('Comienza la conversación desde un WhatsApp vinculado antes de adjuntar el archivo. No se enviará por Meta.');
 const line=context.lines.find(l=>l.ready);if(!line||!context.sourceId)throw Error('No hay un WhatsApp vinculado disponible para responder. No se enviará por Meta.');
 const queued=await continueManually(db,{...args,sourceId:context.sourceId,lineKey:line.line_key,phone:line.linked_phone,requestId:randomUUID()});
 return {messageId:queued.message_row_id as string,whatsappMessageId:queued.message_id as string};
}
