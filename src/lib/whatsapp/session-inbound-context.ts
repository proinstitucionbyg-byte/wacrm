import{AsyncLocalStorage}from'node:async_hooks';
type SessionInbound={accountId:string;conversationId:string;lineKey:string;messageRowId:string;providerMessageId:string};
const context=new AsyncLocalStorage<Readonly<SessionInbound>>();
export function withSessionInbound<T>(value:SessionInbound,run:()=>T):T{return context.run(Object.freeze({...value}),run);}
export function currentSessionInbound(conversationId:string){const value=context.getStore();return value?.conversationId===conversationId?value:null;}
