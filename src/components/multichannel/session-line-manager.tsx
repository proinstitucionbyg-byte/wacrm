'use client';

import {useState} from 'react';
import type {FormEvent} from 'react';

type Line={line_key:string;linked_phone:string;worker_id:string;paused:boolean};
type Worker={id:string;name:string;enabled:boolean};
const inputClass='w-full rounded-lg border border-border bg-background px-3 py-2 text-sm';
const buttonClass='rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-40';

export function SessionLineManager(){
 const [lines,setLines]=useState<Line[]>([]),[workers,setWorkers]=useState<Worker[]>([]);
 const [loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const [link,setLink]=useState(''),[worker,setWorker]=useState('');
 async function request(body?:unknown){
  const r=await fetch('/api/multichannel/whatsapp/control',{method:body?'POST':'GET',cache:'no-store',headers:body?{'Content-Type':'application/json'}:undefined,...(body?{body:JSON.stringify(body)}:{})});
  const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.error||'No se pudo consultar el registro de WhatsApp.');return data;
 }
 async function refresh(){
  const data=await request();setLines(data.lines);setWorkers(data.workers);setLoaded(true);
  if(!worker){const enabled=data.workers.filter((row:Worker)=>row.enabled);if(enabled.length===1)setWorker(enabled[0].id);}
 }
 async function load(){setBusy(true);setMessage('');try{await refresh();}catch(error){setMessage(error instanceof Error?error.message:'No se pudo cargar.');}finally{setBusy(false);}}
 async function register(event:FormEvent){
  event.preventDefault();setBusy(true);setMessage('');
  try{
   let value;try{value=JSON.parse(link);}catch{throw Error('Copia el vínculo desde el panel de WhatsApp y pégalo completo aquí.');}
   if(!value||typeof value.line_key!=='string'||typeof value.linked_phone!=='string')throw Error('El vínculo debe incluir la línea y su número confirmado.');
   await request({action:'register_line',line_key:value.line_key,linked_phone:value.linked_phone,worker_id:worker});
   setLink('');await refresh();setMessage('Número registrado en pausa. Revisa el número y pulsa «Habilitar automatizaciones».');
  }catch(error){setMessage(error instanceof Error?error.message:'No se pudo registrar.');}finally{setBusy(false);}
 }
 async function pause(line:Line){
  setBusy(true);setMessage('');try{await request({action:'pause_line',line_key:line.line_key,value:!line.paused});await refresh();setMessage(line.paused?'Automatizaciones habilitadas para esta línea. El teléfono debe permanecer conectado.':'Automatizaciones pausadas para esta línea.');}catch(error){setMessage(error instanceof Error?error.message:'No se pudo guardar.');}finally{setBusy(false);}
 }
 return <section className="space-y-4 rounded-xl border border-border p-4">
  <h2 className="text-lg font-semibold">Mis números de WhatsApp y sus automatizaciones</h2>
  <p className="text-sm text-muted-foreground">Puedes abrir hasta diez números en el panel local. Primero vincula cada teléfono con su QR. Después copia su vínculo y regístralo aquí para que utilice las automatizaciones e IA del CRM.</p>
  <button className={buttonClass} type="button" disabled={busy} onClick={load}>{loaded?'Actualizar números':'Ver y activar mis números'}</button>
  {message&&<p role="status" className="text-sm">{message}</p>}
  {loaded&&<>
   <ul className="space-y-3">{lines.map(line=><li key={line.line_key} className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3">
    <span className="grow text-sm"><strong>+{line.linked_phone}</strong> · {line.paused?'Automatizaciones en pausa':'Automatizaciones habilitadas'}<small className="block text-muted-foreground">{line.line_key}</small></span>
    <button className={buttonClass} disabled={busy} type="button" onClick={()=>pause(line)}>{line.paused?'Habilitar automatizaciones':'Pausar automatizaciones'}</button>
   </li>)}</ul>
   <form onSubmit={register} className="space-y-3">
    <label className="block text-sm">Vínculo copiado del panel de WhatsApp<textarea className={inputClass} required maxLength={512} value={link} onChange={event=>setLink(event.target.value)} placeholder="Pega aquí con Ctrl + V"/></label>
    <label className="block text-sm">Computadora que mantiene los WhatsApps conectados<select className={inputClass} required value={worker} onChange={event=>setWorker(event.target.value)}><option value="">Selecciona tu ejecutor</option>{workers.filter(row=>row.enabled).map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
    <button className={buttonClass} disabled={busy||!worker||!link.trim()} type="submit">Registrar este número en el CRM</button>
   </form>
  </>}
 </section>;
}
