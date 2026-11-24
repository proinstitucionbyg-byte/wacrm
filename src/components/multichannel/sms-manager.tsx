'use client';
import {useState} from 'react';
import {z} from 'zod';
import {smsOwnerActionSchema} from '@/lib/multichannel/sms-protocol';
import {limaInputToISO} from '@/lib/multichannel/recipient-list';
import {SmsBatchEditor} from './sms-batch-editor';
const dataSchema=z.object({
 lines:z.array(z.object({line_key:z.string(),paused:z.boolean(),available:z.boolean(),ready_at:z.string().nullable(),interval_seconds:z.number(),daily_limit:z.number()})),
 permissions:z.array(z.object({contact_id:z.string().uuid(),recipient:z.string(),purpose:z.enum(['notice','support']),granted:z.boolean(),expires_at:z.string()})),
 jobs:z.array(z.object({id:z.string(),line_key:z.string(),status:z.string(),run_at:z.string(),provider_state:z.string().nullable()})),
});
const input='w-full rounded-lg border border-border bg-background px-3 py-2 text-sm';
const button='rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-40';
const when=(value:string)=>new Date(value).toLocaleString('es-PE',{timeZone:'America/Lima'});
const states:Record<string,string>={queued:'Programado',claimed:'Reservado',dispatching:'Enviando',accepted:'Aceptado por el dispositivo',sent:'Enviado',delivered:'Entregado',needs_review:'Revisar resultado',failed:'Falló',expired:'Vencido',cancelled:'Cancelado'};
async function request(body?:unknown){const response=await fetch('/api/multichannel/sms/control',{method:body?'POST':'GET',cache:'no-store',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});const value=await response.json();if(!response.ok)throw Error(value.error||'No se confirmó la operación. Consulta el estado antes de repetir.');return value;}
export function SmsManager(){
 const [data,setData]=useState<z.infer<typeof dataSchema>|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [line,setLine]=useState(''),[permission,setPermission]=useState(''),[body,setBody]=useState(''),[start,setStart]=useState(''),[end,setEnd]=useState('');
 const [review,setReview]=useState<z.infer<typeof smsOwnerActionSchema>|null>(null),[dedup,setDedup]=useState(()=>crypto.randomUUID());
 async function load(){const value=dataSchema.parse(await request());setData(value);return value;}
 async function refresh(){setBusy(true);setError('');try{await load();}catch(e){setError(e instanceof Error?e.message:'No se pudo consultar.');}finally{setBusy(false);}}
 function changed(){setReview(null);setNotice('');setDedup(crypto.randomUUID());}
 function prepare(){setError('');setNotice('');try{
  const p=data?.permissions.find(p=>p.contact_id+':'+p.purpose===permission&&p.granted&&Date.parse(p.expires_at)>Date.now());
  if(!p)throw Error('Selecciona un destinatario con permiso SMS vigente.');
  const run=limaInputToISO(start),expiry=limaInputToISO(end);
  if(Date.parse(run)<Date.now()||Date.parse(expiry)>Date.parse(p.expires_at))throw Error('Programa una hora futura y un vencimiento cubierto por el permiso SMS.');
  setReview(smsOwnerActionSchema.parse({action:'enqueue',line_key:line,contact_id:p.contact_id,purpose:p.purpose,body,dedup_key:'sms-panel:'+dedup,priority:0,run_at:run,expires_at:expiry}));
 }catch(e){setError(e instanceof z.ZodError?'Revisa la línea, el texto y las fechas.':e instanceof Error?e.message:'Revisa los datos.');}}
 async function save(){if(!review||busy)return;setBusy(true);setError('');try{await request(review);setReview(null);setDedup(crypto.randomUUID());setNotice('SMS programado. La entrega se confirma por separado; un resultado incierto no se reenvía automáticamente.');await load();}catch(e){setError(e instanceof Error?e.message:'No se confirmó el guardado.');}finally{setBusy(false);}}
 async function pause(key:string,value:boolean){setBusy(true);setError('');try{await request({action:'pause_line',line_key:key,value});await load();setNotice(value?'Línea SMS pausada.':'Línea SMS reanudada. Necesita dispositivo disponible y permisos vigentes para enviar.');}catch(e){setError(e instanceof Error?e.message:'No se confirmó el cambio.');}finally{setBusy(false);}}
 return <section className="space-y-3 rounded-xl border border-border p-4" aria-label="SMS programados">
  <h2 className="text-lg font-semibold">SMS · mensajes de texto de la SIM</h2><p className="text-sm text-muted-foreground">Úsalos cuando los programes expresamente o como respaldo configurado. Las respuestas por WhatsApp continúan por WhatsApp. SMS admite texto y emojis; no audio, imágenes ni video. Los emojis pueden dividir el texto en más SMS; el costo depende de tu operador.</p>
  <button className={button} disabled={busy} onClick={()=>void refresh()}>{data?'Actualizar estado SMS':'Consultar y programar SMS'}</button>
  {error&&<p role="alert" className="text-sm text-red-400">{error}</p>}{notice&&<p role="status" className="text-sm">{notice}</p>}
  {data&&<><ul className="space-y-2">{data.lines.map(item=><li key={item.line_key} className="flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm"><span className="grow">{item.line_key} · {item.paused?'Pausada':'Reanudada'} · {item.available&&item.ready_at&&Date.now()-Date.parse(item.ready_at)<90000?'Dispositivo disponible':'Sin conexión confirmada'}<small className="block">Intervalo mínimo: {item.interval_seconds} s · Límite diario: {item.daily_limit}</small></span><button className={button} disabled={busy} onClick={()=>void pause(item.line_key,!item.paused)}>{item.paused?'Reanudar SMS':'Pausar SMS'}</button></li>)}</ul>
  {!data.lines.length?<p className="text-sm">Todavía no hay una SIM configurada. Tener WhatsApp vinculado no habilita los SMS de ese teléfono.</p>:<fieldset disabled={busy} className="space-y-3" onChange={changed}><legend className="font-medium">Programar un SMS</legend>
   <label className="block text-sm">Línea SMS<select className={input} value={line} onChange={e=>setLine(e.target.value)}><option value="">Elige una línea</option>{data.lines.map(item=><option key={item.line_key} value={item.line_key}>{item.line_key}</option>)}</select></label>
   <label className="block text-sm">Destinatario autorizado<select className={input} value={permission} onChange={e=>setPermission(e.target.value)}><option value="">Elige un permiso SMS vigente</option>{data.permissions.filter(p=>p.granted&&Date.parse(p.expires_at)>Date.now()).map(p=><option key={p.contact_id+':'+p.purpose} value={p.contact_id+':'+p.purpose}>{p.recipient} · {p.purpose==='notice'?'Aviso':'Soporte'}</option>)}</select></label>
   <label className="block text-sm">Texto<textarea className={input} maxLength={4000} rows={3} value={body} onChange={e=>setBody(e.target.value)}/></label>
   <div className="grid gap-2 sm:grid-cols-2"><label className="text-sm">Enviar el (hora de Lima)<input className={input} type="datetime-local" value={start} onChange={e=>setStart(e.target.value)}/></label><label className="text-sm">No enviar después de<input className={input} type="datetime-local" value={end} onChange={e=>setEnd(e.target.value)}/></label></div>
   <button className={button} type="button" onClick={prepare}>Revisar SMS</button>
  </fieldset>}
  {review?.action==='enqueue'&&<div className="space-y-2 rounded-lg border border-amber-400 p-3"><h3 className="font-medium">Revisa antes de programar</h3><p className="text-sm">{data.permissions.find(p=>p.contact_id===review.contact_id&&p.purpose===review.purpose)?.recipient} · {review.line_key} · {when(review.run_at)}</p><p className="whitespace-pre-wrap text-sm">{review.body}</p><button className={button} disabled={busy} onClick={()=>void save()}>Confirmar y programar SMS</button></div>}
  {!!data.lines.length&&<SmsBatchEditor lines={data.lines} permissions={data.permissions} onSaved={load}/>}
  <h3 className="font-medium">Últimos 100 SMS</h3><ul className="max-h-64 overflow-y-auto text-sm">{data.jobs.map(job=><li key={job.id} className="border-b py-2">{when(job.run_at)} · {job.line_key} · {states[job.status]||job.status}</li>)}</ul></>}
 </section>;
}
