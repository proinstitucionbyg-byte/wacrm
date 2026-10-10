'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
interface TransferRequest { id:string;conversation_id:string;recipient_id:string;contact_label:string;full_history:boolean;status:string }
export function TeamTransferRequests({threadId,userId}:{threadId:string;userId:string}) {
  const router=useRouter();
  const [requests,setRequests]=useState<TransferRequest[]>([]),[busy,setBusy]=useState(''),[error,setError]=useState('');
  const load=useCallback(async()=>{
    try { const res=await fetch(`/api/team-chat/transfers?thread=${threadId}`); if(!res.ok)throw Error('No se pudieron cargar las derivaciones.'); const body=await res.json();setRequests(body.requests); }
    catch(e){setError(e instanceof Error?e.message:'No se pudo cargar.');}
  },[threadId]);
  useEffect(()=>{void Promise.resolve().then(load);const timer=setInterval(()=>{if(!document.hidden)void load();},10000);return()=>clearInterval(timer);},[load]);
  async function resolve(item:TransferRequest,accept:boolean){
    setBusy(item.id);setError('');
    try {const res=await fetch('/api/team-chat/transfers',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:item.id,accept})});const body=await res.json();if(!res.ok)throw Error(body.error);await load();if(body.status==='accepted')router.push(`/inbox?c=${body.conversation_id}`);else if(body.status==='stale')setError('El responsable cambio. Solicita una nueva derivacion.');}
    catch(e){setError(e instanceof Error?e.message:'No se pudo resolver.');}finally{setBusy('');}
  }
  return <div className="space-y-2">{requests.map(item=><section key={item.id} className="rounded-lg border border-sky-500/40 bg-sky-500/10 p-3 text-sm">
    <p className="font-semibold">DERIVACION · {item.contact_label}</p><p>HISTORIAL {item.full_history?'COMPLETO':'VACIO DESDE LA ACEPTACION'} · {item.status==='pending'?'PENDIENTE DE ACEPTACION':item.status.toUpperCase()}</p>
    {item.status==='pending'&&item.recipient_id===userId&&<div className="mt-2 flex gap-2"><Button size="sm" disabled={!!busy} onClick={()=>void resolve(item,true)}>ACEPTAR Y ABRIR CHAT</Button><Button size="sm" variant="outline" disabled={!!busy} onClick={()=>void resolve(item,false)}>RECHAZAR</Button></div>}
  </section>)}{error&&<p role="alert" className="text-destructive text-sm">{error}</p>}</div>;
}
