'use client';

import {useCallback,useEffect,useRef} from 'react';
import {usePathname} from 'next/navigation';
import {useRealtime} from '@/hooks/use-realtime';

/** Counts contacts awaiting an answer, never individual messages or unread opens. */
export function PendingInboxTitle(){
 const pathname=usePathname();
 const countRef=useRef<number|null>(null);
 const refreshRef=useRef<()=>void>(()=>{});
 const notify=useCallback(()=>refreshRef.current(),[]);
 useRealtime({channelName:'inbox-pending-title',onMessageEvent:notify,onConversationEvent:notify});
 useEffect(()=>{
  let stopped=false,busy=false;
  let timer:ReturnType<typeof setTimeout>|undefined;
  const refresh=async()=>{
   if(stopped||busy)return;
   busy=true;
   try{
    const response=await fetch('/api/inbox/pending-count',{cache:'no-store',signal:AbortSignal.timeout(10000)});
    if(!response.ok)return;
    const data=await response.json();
    if(stopped||!Number.isSafeInteger(data.count)||data.count<0)return;
    countRef.current=data.count;
    document.title=data.count>0?`(${data.count}) WACRM`:'WACRM';
   }catch{/* Keep the last confirmed count on a transient outage. */}
   finally{busy=false;}
  };
  const schedule=()=>{clearTimeout(timer);timer=setTimeout(()=>void refresh(),350);};
  refreshRef.current=schedule;
  const interval=setInterval(()=>void refresh(),15000);
  const visible=()=>{if(document.visibilityState==='visible')void refresh();};
  document.addEventListener('visibilitychange',visible);
  void refresh();
  return()=>{stopped=true;clearTimeout(timer);clearInterval(interval);document.removeEventListener('visibilitychange',visible);refreshRef.current=()=>{};document.title='WACRM';};
 },[]);
 useEffect(()=>{
  // Next can update page metadata during navigation; preserve the confirmed count.
  const count=countRef.current;
  if(count!==null)document.title=count>0?`(${count}) WACRM`:'WACRM';
 },[pathname]);
 return null;
}
