'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import type { TeamMember } from '@/lib/team-chat';
export function TeamWhatsappTransfer({members,threadId}:{members:TeamMember[];threadId:string}) {
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [chats,setChats]=useState<{id:string;name:string}[]>([]),[conversation,setConversation]=useState(''),[agent,setAgent]=useState(''),[full,setFull]=useState(false);
  async function show() {
    setBusy(true);setError('');
    try {
      const {data,error}=await createClient().from('conversations').select('id,contact:contacts(name,phone)').neq('status','closed').order('last_message_at',{ascending:false}).limit(100);
      if(error)throw error;
      setChats((data??[]).map(row=>{ const contact=Array.isArray(row.contact)?row.contact[0]:row.contact;return{id:row.id,name:`${contact?.name||'SIN NOMBRE'} · ${contact?.phone||''}`};}));
      setOpen(true);
    }catch {setError('No se pudieron cargar los chats disponibles.');}finally{setBusy(false);}
  }
  async function transfer() {
    setBusy(true);setError('');
    try {
      const response=await fetch('/api/team-chat/transfers',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({thread:threadId,conversation,recipient:agent,full_history:full})});
      const result=await response.json();if(!response.ok)throw Error(result.error||'No se pudo derivar');
      setError('SOLICITUD ENVIADA. EL CHAT CONSERVA SU RESPONSABLE HASTA QUE EL DESTINATARIO ACEPTE.');setOpen(false);
    }catch(err){setError(err instanceof Error?err.message:'No se pudo derivar');}finally{setBusy(false);}
  }
  return <div className="space-y-2"><Button variant="outline" disabled={busy} onClick={()=>open?setOpen(false):void show()}>DERIVAR CHAT DE WHATSAPP</Button>{open&&<div className="border-border space-y-2 rounded border p-3">
    <label className="block text-sm">CHAT (ULTIMOS 100 VISIBLES)<select className="bg-background border-border block w-full rounded border p-2" value={conversation} onChange={event=>setConversation(event.target.value)}><option value="">SELECCIONAR NUMERO</option>{chats.map(chat=><option key={chat.id} value={chat.id}>{chat.name}</option>)}</select></label>
    <label className="block text-sm">DESTINATARIO<select className="bg-background border-border block w-full rounded border p-2" value={agent} onChange={event=>setAgent(event.target.value)}><option value="">SELECCIONAR ASESORA</option>{members.map(member=><option key={member.user_id} value={member.user_id}>{member.nickname||member.full_name} · {member.area||'SIN AREA'}</option>)}</select></label>
    <label className="flex gap-2 text-sm"><input type="checkbox" checked={full} onChange={event=>setFull(event.target.checked)}/>COMPARTIR TODO EL HISTORIAL QUE TENGO AUTORIZADO</label>
    <p className="text-muted-foreground text-xs">Sin marcar: el destinatario inicia con historial vacio desde que acepta. Al aceptar cambia la etiqueta y se prepara su saludo para Enviar.</p>
    <Button disabled={busy||!agent||!conversation} onClick={()=>void transfer()}>ENVIAR SOLICITUD DE DERIVACION</Button>
    </div>}{error&&<p role="status" className="text-sm">{error}</p>}</div>;
}
