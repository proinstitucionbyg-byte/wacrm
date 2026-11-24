'use client';
import {createContext,useCallback,useContext,useRef,useState,type ReactNode} from 'react';
import {Pause,Play,X,Volume2,AudioLines} from 'lucide-react';
import {cn} from '@/lib/utils';
type Track={id:string;src:string;label:string};
type AudioState={track:Track|null;playing:boolean;error:string;toggle:(track:Track)=>void;stop:()=>void;onPlay:()=>void;onPause:()=>void;onError:()=>void};
const WorkspaceAudioContext=createContext<AudioState|null>(null);
const AudioRegistrationContext=createContext<((node:HTMLAudioElement|null)=>void)|null>(null);
export function WorkspaceAudioProvider({children}:{children:ReactNode}){
 const audioRef=useRef<HTMLAudioElement|null>(null),trackRef=useRef<Track|null>(null),attempt=useRef(0);
 const [track,setTrack]=useState<Track|null>(null),[playing,setPlaying]=useState(false),[error,setError]=useState('');
 const stop=useCallback(()=>{attempt.current++;trackRef.current=null;const audio=audioRef.current;if(audio){audio.pause();audio.removeAttribute('src');audio.load();}setTrack(null);setPlaying(false);setError('');},[]);
 const toggle=useCallback((next:Track)=>{
  const audio=audioRef.current;if(!audio)return;
  if(trackRef.current?.id===next.id&&trackRef.current.src===next.src&&!audio.paused){audio.pause();return;}
  try{
   const url=new URL(next.src,window.location.origin);if(!['https:','http:'].includes(url.protocol))throw Error('Enlace de audio no admitido.');
   const token=++attempt.current;setError('');
   if(trackRef.current?.id!==next.id||trackRef.current.src!==next.src){audio.pause();trackRef.current=next;setTrack(next);audio.src=next.src;audio.load();}
   void audio.play().catch(()=>{if(attempt.current===token&&trackRef.current){setPlaying(false);setError('No se pudo reproducir. Vuelve a pulsar Escuchar o revisa el archivo.');}});
  }catch(e){setError(e instanceof Error?e.message:'No se pudo reproducir el audio.');}
 },[]);
 const registerAudio=useCallback((node:HTMLAudioElement|null)=>{const previous=audioRef.current;if(previous&&previous!==node){attempt.current++;previous.pause();previous.removeAttribute('src');previous.load();}audioRef.current=node;},[]);
 const onError=()=>{if(trackRef.current){setPlaying(false);setError('El audio no pudo cargarse. El archivo puede no estar disponible.');}};
 return <AudioRegistrationContext.Provider value={registerAudio}><WorkspaceAudioContext.Provider value={{track,playing,error,toggle,stop,onPlay:()=>setPlaying(true),onPause:()=>setPlaying(false),onError}}>{children}</WorkspaceAudioContext.Provider></AudioRegistrationContext.Provider>;
}
/** Mounted once beside the dashboard header; route changes never remount it. */
export function WorkspaceAudioPlayer(){
 const registerAudio=useContext(AudioRegistrationContext);
 const player=useContext(WorkspaceAudioContext);if(!player)return null;
 return <section aria-label="Audio continuo" className={cn('crm-audio-player shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-b px-3 py-2 sm:grid-cols-[minmax(0,1fr)_minmax(200px,360px)_auto] sm:px-5',player.track?'grid':'hidden')}>
  <div className="min-w-0"><p className="flex items-center gap-2 truncate text-xs font-semibold"><Volume2 className="size-4 shrink-0"/><span className="truncate">{player.track?.label||'Audio'}</span></p><p className="truncate text-[11px] text-muted-foreground">{player.error||(player.playing?'Reproduciendo · puedes cambiar de pantalla':'En pausa · puedes continuar desde aquí')}</p></div>
  <audio ref={registerAudio} controls preload="none" aria-label="Reproductor de audio continuo" className="col-span-2 row-start-2 h-9 w-full min-w-0 sm:col-span-1 sm:col-start-2 sm:row-start-1" onPlay={player.onPlay} onPause={player.onPause} onEnded={player.onPause} onError={player.onError}/>
  <button type="button" onClick={player.stop} aria-label="Detener y cerrar audio" title="Detener y cerrar audio" className="col-start-2 row-start-1 flex size-9 items-center justify-center rounded-lg border hover:bg-muted sm:col-start-3"><X className="size-4"/></button>
 </section>;
}
export function PersistentMessageAudio({id,src,label='Audio del chat'}:Track){
 const player=useContext(WorkspaceAudioContext);
 if(!player)return <audio src={src} controls preload="none" className="max-w-full"/>;
 const active=player.track?.id===id&&player.track.src===src,playing=active&&player.playing;
 return <div className="max-w-full space-y-1"><button type="button" aria-label={playing?'Pausar audio':'Escuchar audio'} aria-pressed={playing} onClick={event=>{event.stopPropagation();player.toggle({id,src,label});}} className="flex min-h-11 max-w-full items-center gap-2 rounded-full border border-current/20 bg-black/10 px-4 py-2 text-sm font-medium hover:bg-black/20">{playing?<Pause className="size-4 shrink-0"/>:<Play className="size-4 shrink-0"/>}<span>{playing?'Pausar audio':active?'Continuar audio':'Escuchar audio'}</span><AudioLines aria-hidden="true" className="crm-audio-wave"/></button><p className="text-[10px] opacity-80">{active?'Disponible en el reproductor superior':'Puedes seguir escuchándolo al cambiar de pantalla.'}</p></div>;
}
