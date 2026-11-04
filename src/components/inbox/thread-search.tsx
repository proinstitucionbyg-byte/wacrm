'use client';
import {useEffect,useState} from 'react';
import {Search} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
type Match={id:string;text:string;createdAt:string;senderType:string};
export function ThreadSearch({conversationId}:{conversationId:string}){
 const[open,setOpen]=useState(false),[query,setQuery]=useState(''),[result,setResult]=useState<{query:string;matches:Match[];hasMore:boolean;nextOffset:number}|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{
  if(!open||query.trim().length<2)return;
  const controller=new AbortController();
  const timer=setTimeout(async()=>{setBusy(true);setError('');try{
   const response=await fetch('/api/inbox/search?'+new URLSearchParams({q:query.trim(),conversation:conversationId}),{signal:controller.signal});
   const data=await response.json();if(!response.ok)throw Error(data.error||'No se pudo buscar.');
   if(!controller.signal.aborted)setResult({...data,query:query.trim()});
  }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'No se pudo buscar.');}finally{if(!controller.signal.aborted)setBusy(false);}},300);
  return()=>{clearTimeout(timer);controller.abort();};
 },[open,query,conversationId]);
 async function more(){if(!result||busy||result.query!==query.trim())return;setBusy(true);setError('');try{
  const response=await fetch('/api/inbox/search?'+new URLSearchParams({q:result.query,conversation:conversationId,offset:String(result.nextOffset)}));
  const data=await response.json();if(!response.ok)throw Error(data.error||'No se pudo continuar la búsqueda.');
  setResult(current=>current?.query===result.query?{...data,query:current.query,matches:[...current.matches,...data.matches]}:current);
 }catch(e){setError(e instanceof Error?e.message:'No se pudo buscar.');}finally{setBusy(false);}}
 const visible=result?.query===query.trim()?result:null;
 return <><Button variant="outline" size="icon" title="Buscar dentro del chat" aria-label="Buscar dentro del chat" onClick={()=>setOpen(true)}><Search className="h-4 w-4"/></Button>
 <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[85dvh] overflow-y-auto"><DialogHeader><DialogTitle>Buscar dentro de esta conversación</DialogTitle><DialogDescription>Busca en el historial disponible para ti, incluidos mensajes anteriores a los cargados en pantalla.</DialogDescription></DialogHeader>
 <Input aria-label="Texto o teléfono dentro del chat" placeholder="Escribe texto o un teléfono…" value={query} onChange={e=>{setQuery(e.target.value);setBusy(false);setError('');}}/>
 {error&&<p role="alert">{error}</p>}{busy&&<p role="status">Buscando…</p>}
 {visible&&<><p className="text-sm text-muted-foreground">{visible.matches.length} coincidencias{visible.hasMore?' · quedan mensajes por revisar':''}</p><ol className="space-y-3">{visible.matches.map(row=><li key={row.id} className="rounded-md border p-3"><p className="mb-1 text-xs text-muted-foreground">{row.senderType==='customer'?'Contacto':'Equipo'} · {new Date(row.createdAt).toLocaleString('es-PE',{timeZone:'America/Lima'})}</p><p className="whitespace-pre-wrap break-words text-sm">{row.text}</p></li>)}</ol>{visible.hasMore&&<Button disabled={busy} variant="outline" onClick={()=>void more()}>Buscar en mensajes anteriores</Button>}</>}
 </DialogContent></Dialog></>;
}
