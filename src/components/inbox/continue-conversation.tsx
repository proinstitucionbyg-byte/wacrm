'use client';
import {useEffect,useState} from 'react';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import type {Message} from '@/types';
type Line={line_key:string;linked_phone:string;ready:boolean};
type Context={sourceId:string|null;cloud:boolean;adOrigin:boolean;lines:Line[]};
type Job={source_id:string;line_key:string;phone:string;text:string;request_id:string};
export function ContinueConversation({conversationId,onQueued}:{conversationId:string;onQueued:(line:string,message:Message|null)=>void}){
 const [data,setData]=useState<Context|null>(null),[open,setOpen]=useState(false),[line,setLine]=useState(''),[text,setText]=useState('Hola, te escribimos de INSTICRECE para continuar con tu consulta.'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[pending,setPending]=useState<Job|null>(null),[revision,setRevision]=useState(0);
 const key='wacrm:continue:'+conversationId;
 useEffect(()=>{const abort=new AbortController();void fetch('/api/inbox/conversations/'+conversationId+'/continue',{cache:'no-store',signal:abort.signal}).then(async r=>{const b=await r.json();if(!r.ok)throw Error(b.error||'No se pudieron consultar los números.');if(!abort.signal.aborted){setData(b);setLine(old=>old||b.lines.find((l:Line)=>l.linked_phone==='51933691668'&&l.ready)?.line_key||b.lines.find((l:Line)=>l.ready)?.line_key||'');}}).catch(e=>{if(!abort.signal.aborted)setError(e.message);});return()=>abort.abort();},[conversationId,revision]);
 useEffect(()=>{try{const old=JSON.parse(sessionStorage.getItem(key)||'null') as Job|null;if(old?.request_id&&old.text&&old.line_key&&old.source_id){setPending(old);setOpen(true);setText(old.text);setLine(old.line_key);}}catch{/* Ignore damaged local state. */}},[key]);
 async function send(){const chosen=data?.lines.find(l=>l.line_key===line);if(!pending&&(!chosen?.ready||!data?.sourceId||!text.trim()))return;const job=pending??{source_id:data!.sourceId!,line_key:chosen!.line_key,phone:chosen!.linked_phone,text:text.trim(),request_id:crypto.randomUUID()};setPending(job);try{sessionStorage.setItem(key,JSON.stringify(job));}catch{}setBusy(true);setError('');let notQueued=false;try{const response=await fetch('/api/inbox/conversations/'+conversationId+'/continue',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(job),signal:AbortSignal.timeout(30000)});const b=await response.json();if(!response.ok){if(b.not_enqueued===true){notQueued=true;setPending(null);sessionStorage.removeItem(key);}throw Error(b.error||'No se confirmó el envío.');}sessionStorage.removeItem(key);setPending(null);setOpen(false);onQueued(b.line_key,b.message??null);}catch(e){setError((e instanceof Error?e.message:'No se confirmó el envío.')+(notQueued?' Puedes actualizar y elegir otro número.':' Reintentar consulta el mismo envío, sin duplicarlo.'));}finally{setBusy(false);}}
 if(!pending&&(!data||!data.cloud))return null;
 return <>
  <div className="relative isolate flex h-11 shrink-0 items-center gap-2 border-t bg-card px-3" style={{contain:'layout paint'}} aria-label="Continuar por WhatsApp vinculado">
   <button type="button" className="rounded-lg border border-sky-500 px-3 py-1.5 text-xs font-semibold text-sky-500" onClick={()=>setOpen(true)}>Comenzar conversación</button>
   <span className="truncate text-[11px] text-muted-foreground">WhatsApp principal: 933691668</span>
  </div>
  <Dialog open={open} onOpenChange={value=>{if(!busy)setOpen(value);}}>
   <DialogContent className="sm:max-w-lg">
    <DialogTitle>Comenzar conversación</DialogTitle>
    <DialogDescription>Elige desde qué WhatsApp escribir. El mensaje quedará en este mismo historial y no se enviará por Meta.</DialogDescription>
    <label className="text-xs">Número de salida<select aria-label="Número para comenzar conversación" value={line} disabled={busy||!!pending} onChange={e=>setLine(e.target.value)} className="mt-1 w-full rounded border bg-background p-2 text-sm"><option value="">Elige un número conectado</option>{data?.lines.map(l=><option key={l.line_key} value={l.line_key} disabled={!l.ready}>+{l.linked_phone}{l.linked_phone==='51933691668'?' · Principal':''}{l.ready?' · Conectado':' · No disponible'}</option>)}</select></label>
    <button type="button" disabled={busy} onClick={()=>setRevision(v=>v+1)} className="justify-self-start rounded border px-2 py-1 text-xs">Actualizar conexiones</button>
    <label className="text-xs">Tu mensaje<textarea aria-label="Mensaje para comenzar conversación" value={text} maxLength={4000} rows={4} disabled={busy||!!pending} onChange={e=>setText(e.target.value)} className="mt-1 w-full rounded-lg border bg-background p-2 text-sm"/></label>
    <button type="button" onClick={()=>void send()} disabled={busy||(!pending&&(!data?.sourceId||!data?.lines.find(l=>l.line_key===line)?.ready||!text.trim()))} className="rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-40">{busy?'Confirmando…':pending?'Revisar el mismo envío':'Enviar y comenzar conversación'}</button>
    {!data?.lines.some(l=>l.ready)&&<p className="text-xs text-amber-500">No hay líneas conectadas. Revisa Bot multicanal.</p>}
    {pending&&<p className="text-xs text-muted-foreground">Hay un envío pendiente de confirmación. Revisarlo conserva el mismo identificador y evita duplicados.</p>}
    {error&&<p role="alert" className="text-xs text-red-500">{error}</p>}
   </DialogContent>
  </Dialog>
 </>;
}
