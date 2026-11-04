import type{SupabaseClient}from'@supabase/supabase-js';
import{validateInteractivePayload,type InteractiveMessagePayload}from'./interactive';
import{enqueueSessionTextIfRequired,getSessionOriginLineForConversation}from'./session-transport-guard';

export function renderSessionTextMenu(payload:InteractiveMessagePayload){
 const validation=validateInteractivePayload(payload);if(!validation.ok)throw Error(validation.error);
 const options=payload.kind==='buttons'?payload.buttons:payload.sections.flatMap(section=>section.rows);
 if(new Set(options.map(option=>option.id)).size!==options.length)throw Error('El menú tiene identificadores repetidos.');
 const text=[payload.header,payload.body,'',...options.map((option,index)=>(index+1)+'. '+option.title),payload.footer,'','Responde con el número de la opción.'].filter(value=>value!==undefined).join('\n');
 if(text.length>4000)throw Error('El menú supera el límite de texto de WhatsApp.');
 return{text,options:options.map(option=>({id:option.id,title:option.title}))};
}
export async function enqueueSessionMenuIfRequired(db:SupabaseClient,args:{accountId:string;conversationId:string;payload:InteractiveMessagePayload}){
 // Cloud paths keep their existing buttons. Never fall back to another number.
 if(!await getSessionOriginLineForConversation(db,args.conversationId))return null;
 const menu=renderSessionTextMenu(args.payload);
 return enqueueSessionTextIfRequired(db,{accountId:args.accountId,conversationId:args.conversationId,text:menu.text,menuOptions:menu.options});
}
