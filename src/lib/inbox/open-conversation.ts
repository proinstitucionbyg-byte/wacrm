import type{Conversation}from'@/types';
export const OPEN_CONVERSATION_EVENT='wacrm:open-conversation';
export function openInboxConversation(conversation:Conversation,navigate:(url:string)=>void){
 const handled=!window.dispatchEvent(new CustomEvent(OPEN_CONVERSATION_EVENT,{detail:conversation,cancelable:true}));
 if(!handled)navigate('/inbox?c='+encodeURIComponent(conversation.id));
}
