import type {z} from 'zod';
import {groupResult} from './whatsapp-groups';
type List=Extract<z.infer<typeof groupResult>,{kind:'list'}>;
export type GroupListScope={worker_id:string;line_key:string;linked_phone:string};
export const groupListCacheKey=(scope:GroupListScope)=>`wacrm:group-list:${scope.worker_id}:${scope.line_key}:${scope.linked_phone}`;
export function encodeGroupListCache(scope:GroupListScope,list:List,at=Date.now()){
 return JSON.stringify({scope:groupListCacheKey(scope),at,list});
}
/** Use only AFTER the server has authorized this line for the current user. */
export function readGroupListCache(text:string|null,scope:GroupListScope,now=Date.now()):List|null{
 if(!text||text.length>400000)return null;
 try{
  const cached=JSON.parse(text),list=cached.list;
  if(cached.scope!==groupListCacheKey(scope)||!Number.isFinite(cached.at)||cached.at>now||now-cached.at>60000
    ||!Array.isArray(list?.groups)||list.groups.length>1000||list.offset!==0||list.total<list.groups.length)return null;
  if(!groupResult.safeParse({...list,groups:[]}).success)return null;
  for(let i=0;i<list.groups.length;i+=50)if(!groupResult.safeParse({...list,groups:list.groups.slice(i,i+50)}).success)return null;
  if(new Set(list.groups.map((group:{id:string})=>group.id)).size!==list.groups.length)return null;
  return list;
 }catch{return null;}
}
