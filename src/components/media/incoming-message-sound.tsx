'use client';
import {createContext,useCallback,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {Volume2,VolumeX} from 'lucide-react';
import {useAuth} from '@/hooks/use-auth';
import {useMemberPermissions} from '@/hooks/use-member-permissions';
import {useRealtime} from '@/hooks/use-realtime';
import {createIncomingSoundGate,playInsticreceChime,incomingSoundPreference,nextIncomingSoundPreference} from '@/lib/inbox/incoming-sound';
type SoundState={enabled:boolean;ready:boolean;available:boolean;canMute:boolean;toggle:()=>void};
const SoundContext=createContext<SoundState|null>(null);
const preference=(key:string,canMute:boolean)=>{try{return incomingSoundPreference(canMute,localStorage.getItem(key));}catch{return true;}};
export function IncomingMessageSoundProvider({children}:{children:ReactNode}){
 const {accountId,user,profile}=useAuth(),{can}=useMemberPermissions(),allowed=!!profile?.account_role&&can('inbox','view');
 const canMute=profile?.account_role==='owner';
 const key=`insticrece:incoming-sound:${accountId}:${user?.id}`,context=useRef<AudioContext|null>(null);
 const [enabled,setEnabled]=useState(true),[ready,setReady]=useState(false),[available,setAvailable]=useState(true);
 const enabledRef=useRef(true);
 const [gate]=useState(()=>createIncomingSoundGate(Date.now()));
 const prepare=useCallback(async()=>{
  try{
   const Audio=window.AudioContext||(window as unknown as {webkitAudioContext?:typeof AudioContext}).webkitAudioContext;
   if(!Audio){setAvailable(false);return false;}
   if(!context.current||context.current.state==='closed'){context.current=new Audio();context.current.onstatechange=()=>setReady(context.current?.state==='running');}
   await context.current.resume();const running=context.current.state==='running';setReady(running);return running;
  }catch{setReady(false);return false;}
 },[]);
 const dispose=useCallback(()=>{const old=context.current;context.current=null;if(old){old.onstatechange=null;void old.close().catch(()=>{});}},[]);
 const choose=useCallback((next:boolean)=>{enabledRef.current=next;setEnabled(next);if(!next){dispose();setReady(false);}},[dispose]);
 useEffect(()=>{
  let active=true;void Promise.resolve().then(()=>{if(active)choose(preference(key,canMute));});
  const changed=(event:StorageEvent)=>{if(event.key===key)choose(incomingSoundPreference(canMute,event.newValue));};window.addEventListener('storage',changed);
  return()=>{active=false;window.removeEventListener('storage',changed);};
 },[key,canMute,choose]);
 useEffect(()=>{
  if(!enabled||ready||!allowed)return;
  const unlock=(event:Event)=>{if(event.isTrusted&&!(event.target instanceof Element&&event.target.closest('[data-incoming-sound-toggle]')))void prepare();};
  document.addEventListener('pointerdown',unlock,{capture:true});document.addEventListener('keydown',unlock,{capture:true});
  return()=>{document.removeEventListener('pointerdown',unlock,{capture:true});document.removeEventListener('keydown',unlock,{capture:true});};
 },[enabled,ready,allowed,prepare]);
 useEffect(()=>dispose,[dispose]);
 const notify=useCallback((event:{eventType:string;new:{id:string;conversation_id:string;sender_type:string;created_at:string}})=>{
  if(!gate({eventType:event.eventType,new:{id:event.new.id,conversation_id:event.new.conversation_id,sender_type:event.new.sender_type,created_at:event.new.created_at}})||!enabled)return;
  const play=()=>{
   const audio=context.current;if(!enabledRef.current||!audio||audio.state!=='running'||!preference(key,canMute))return;
   const now=Date.now();try{const last=Number(localStorage.getItem(key+':last'));if(last&&now-last<1500)return;localStorage.setItem(key+':last',String(now));}catch{/* Private mode: per-tab deduplication remains active. */}
   playInsticreceChime(audio);
  };
  if(navigator.locks)void navigator.locks.request(key,{ifAvailable:true},lock=>{if(lock)play();}).catch(()=>{});else play();
 },[enabled,gate,key,canMute]);
 useRealtime({channelName:`workspace-incoming-sound:${accountId}:${user?.id}`,onMessageEvent:notify,enabled:!!user&&!!accountId&&allowed});
 const toggle=async()=>{
  const next=nextIncomingSoundPreference(canMute,enabledRef.current);choose(next);try{localStorage.setItem(key,next?'on':'off');}catch{/* The in-memory preference still works. */}
  if(next&&await prepare()&&context.current)playInsticreceChime(context.current);
 };
 return <SoundContext.Provider value={allowed?{enabled,ready,available,canMute,toggle:()=>{void toggle();}}:null}>{children}</SoundContext.Provider>;
}
export function IncomingMessageSoundToggle(){
 const sound=useContext(SoundContext);if(!sound)return null;
 const label=!sound.available?'Este navegador no permite el sonido':!sound.canMute?'Probar sonido de mensajes · siempre activado para asesoras':sound.enabled?'Silenciar sonido de mensajes':'Activar y probar sonido de mensajes';
 return <button type="button" data-incoming-sound-toggle aria-label={label} title={label} aria-pressed={sound.enabled} disabled={!sound.available} onClick={sound.toggle} className="flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50">{sound.enabled?<Volume2 className="size-4"/>:<VolumeX className="size-4"/>}</button>;
}
