import type {SupabaseClient} from '@supabase/supabase-js';
import {INITIAL_GREETING_ID} from '@/lib/automations/greeting-continuity';
import {renderSessionTextMenu} from './session-text-menu';
import {isConfirmedClickToWhatsAppReferral} from './billing';
import type {InteractiveMessagePayload} from './interactive';
import {isSalesInquiry} from '@/lib/sales/attribution';
import {readConversationBillingPreflight} from './billing-runtime';
import {enqueueSupportWait,pendingSupportWait} from './cloud-support-wait';

/** A Cloud customer message stays a Cloud source. Only its reply changes line. */
export async function routeCloudSupportOpening(db:SupabaseClient,args:{accountId:string;conversationId:string;contactId:string;userId:string;messageId:string;hasConfirmedAdOrigin:boolean;contentText?:string|null;interactiveReplyId?:string|null;isFirstInboundMessage?:boolean;contactCreated?:boolean;metaWaitExpired?:boolean}):Promise<boolean>{
 if(process.env.MULTICHANNEL_CLOUD_SUPPORT_ENABLED!=='true'||args.hasConfirmedAdOrigin)return false;
 const policy=await db.from('whatsapp_support_routes').select('enabled').eq('account_id',args.accountId).maybeSingle();
 if(policy.error)throw Error('No se pudo verificar la ruta de soporte; no se enviará por Cloud.');
 if(!policy.data?.enabled)return false;
 const conversation=await db.from('conversations').select('first_ad_referral,whatsapp_support_line_key').eq('id',args.conversationId).eq('account_id',args.accountId).maybeSingle();
 if(conversation.error||!conversation.data)throw Error('No se pudo verificar el origen del contacto.');
 if(isConfirmedClickToWhatsAppReferral(conversation.data.first_ad_referral))return false;
 if(conversation.data.whatsapp_support_line_key)return false;
 if(!args.metaWaitExpired&&await pendingSupportWait(db,args.accountId,args.conversationId))return true;
 // Absence of a referral is not proof that an ongoing commercial journey
 // should change phone. Preserve its original buttons/flow while Cloud permits it.
 const paid=await db.from('contact_tags').select('tags!inner(name)').eq('contact_id',args.contactId).eq('tags.account_id',args.accountId).eq('tags.name','PAGO VALIDADO');
 if(paid.error)throw Error('No se pudo verificar si el contacto ya está matriculado.');
 const recent=await db.from('messages').select('id').eq('conversation_id',args.conversationId).eq('sender_type','bot').is('whatsapp_session_line_key',null)
  .in('status',['sent','delivered','read']).not('interactive_payload','is',null).gte('created_at',new Date(Date.now()-86400000).toISOString()).limit(1).maybeSingle();
 if(recent.error)throw Error('No se pudo verificar la continuidad comercial.');
 const commercial=args.isFirstInboundMessage!==true&&!paid.data?.length&&(!!args.interactiveReplyId||isSalesInquiry(args.contentText??'')||!!recent.data);
 if(commercial){
  const billing=await readConversationBillingPreflight(db,args.accountId,args.conversationId);
  if(billing.automatic_send_allowed)return false;
 }
 if(!args.metaWaitExpired){await enqueueSupportWait(db,args);return true;}
 const automation=await db.from('automations').select('id').eq('id',INITIAL_GREETING_ID).eq('account_id',args.accountId).eq('is_active',true).maybeSingle();
 if(automation.error||!automation.data)throw Error('La bienvenida de soporte no está disponible.');
 const steps=await db.from('automation_steps').select('step_type,step_config,position').eq('automation_id',automation.data.id).is('parent_step_id',null).order('position');
 if(steps.error)throw Error('No se pudo leer la automatización original.');
 const text=steps.data?.find(row=>row.step_type==='send_message')?.step_config?.text;
 const payload=steps.data?.find(row=>row.step_type==='send_buttons'||row.step_type==='send_list')?.step_config;
 if(typeof text!=='string'||!text.trim()||!payload)throw Error('La bienvenida debe tener texto y un menú configurados.');
 const menu=renderSessionTextMenu(payload as InteractiveMessagePayload);
 const body=text.trim()+'\n\n'+menu.text;
 const queued=await db.rpc('enqueue_cloud_support_opening',{p_account_id:args.accountId,p_conversation_id:args.conversationId,p_provider_id:args.messageId,p_body:body,p_options:menu.options});
 if(queued.error||typeof queued.data?.handled!=='boolean')throw Error('No se pudo conservar la derivación a soporte.');
 if(!queued.data.handled)return false;
 const name=queued.data.state==='queued'?'SOPORTE WHATSAPP':'SOPORTE PENDIENTE';
 const lookup=await db.from('tags').select('id').eq('account_id',args.accountId).eq('name',name).limit(1).maybeSingle();
 let tagId=lookup.data?.id;
 if(!lookup.error&&!tagId){const created=await db.from('tags').insert({account_id:args.accountId,user_id:args.userId,name,color:'#0d9488',kind:'process'}).select('id').single();tagId=created.data?.id;}
 if(tagId)await db.from('contact_tags').upsert({contact_id:args.contactId,tag_id:tagId},{onConflict:'contact_id,tag_id',ignoreDuplicates:true});
 // Reuse the institution's existing support area; never invent staff access.
 const area=await db.from('tags').select('id').eq('account_id',args.accountId).eq('name','AREA FIDELIZACION').eq('kind','access').limit(1).maybeSingle();
 if(!area.error&&area.data?.id)await db.from('contact_tags').upsert({contact_id:args.contactId,tag_id:area.data.id},{onConflict:'contact_id,tag_id',ignoreDuplicates:true});
 return true;
}
