'use client';
import{useState}from'react';
import{smsBatchPreview,type smsBatchSchema}from'@/lib/multichannel/sms-batch';
import{limaInputToISO}from'@/lib/multichannel/recipient-list';
import type{z}from'zod';
type Permission={contact_id:string;recipient:string;purpose:'notice'|'support';granted:boolean;expires_at:string};
const input='w-full rounded-lg border border-border bg-background px-3 py-2 text-sm',button='rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-40';
export function SmsBatchEditor({lines,permissions,onSaved}:{lines:{line_key:string;interval_seconds:number;daily_limit:number}[];permissions:Permission[];onSaved:()=>Promise<unknown>}){
 const[line,setLine]=useState(''),[purpose,setPurpose]=useState<'notice'|'support'>('notice'),[phones,setPhones]=useState(''),[body,setBody]=useState(''),[start,setStart]=useState(''),[end,setEnd]=useState('');
 const[interval,setInterval]=useState(10),[block,setBlock]=useState(10),[pause,setPause]=useState(30),[id,setId]=useState(()=>crypto.randomUUID());
 const[review,setReview]=useState<ReturnType<typeof smsBatchPreview>|null>(null),[destinations,setDestinations]=useState<Record<string,string>>({}),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 function changed(){setReview(null);setId(crypto.randomUUID());setNotice('');}
 async function file(file:File){setBusy(true);setError('');try{const{readRecipientFile}=await import('@/lib/multichannel/recipient-import');const rows=await readRecipientFile(file);if(rows.errors.length)throw Error(rows.errors.slice(0,5).join(' '));setPhones(rows.recipients.map(row=>row.phone).join('\n'));changed();}catch(e){setError(e instanceof Error?e.message:'No se pudo leer la lista.');}finally{setBusy(false);}}
 async function prepare(){setBusy(true);setError('');try{
  const{parseRecipientPaste}=await import('@/lib/multichannel/recipient-import');const rows=parseRecipientPaste(phones);if(rows.errors.length)throw Error(rows.errors.slice(0,5).join(' '));
  const expiry=limaInputToISO(end),run=limaInputToISO(start);if(Date.parse(run)<Date.now())throw Error('Elige una hora futura de Lima.');
  const chosenLine=lines.find(item=>item.line_key===line);if(!chosenLine)throw Error('Elige una línea SMS.');if(interval<chosenLine.interval_seconds)throw Error('Esta SIM exige al menos '+chosenLine.interval_seconds+' segundos entre envíos.');
  const chosen=rows.recipients.map(row=>{const matches=permissions.filter(p=>p.recipient===row.phone&&p.purpose===purpose&&p.granted&&Date.parse(p.expires_at)>=Date.parse(expiry));if(matches.length!==1)throw Error('Falta un permiso SMS único y vigente para '+row.phone);return matches[0];});
  const preview=smsBatchPreview({action:'enqueue_batch',request_id:id,line_key:line,purpose,body,contact_ids:chosen.map(p=>p.contact_id),run_at:run,expires_at:expiry,interval_seconds:interval,block_size:block,block_pause_seconds:pause});
  const perDay=new Map<string,number>();for(const job of preview.jobs){const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Lima',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(job.run_at));perDay.set(day,(perDay.get(day)??0)+1);}if([...perDay.values()].some(count=>count>chosenLine.daily_limit))throw Error('El lote supera el límite diario de esta SIM. Reduce destinatarios o distribuye los horarios en más días.');
  setDestinations(Object.fromEntries(chosen.map(p=>[p.contact_id,p.recipient])));setReview(preview);
 }catch(e){setReview(null);setError(e instanceof Error?e.message:'Revisa la lista y el horario.');}finally{setBusy(false);}}
 async function save(plan:z.infer<typeof smsBatchSchema>){if(busy)return;setBusy(true);setError('');try{
  const response=await fetch('/api/multichannel/sms/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(plan),signal:AbortSignal.timeout(30000)});const value=await response.json();if(!response.ok)throw Error(value.error||'No se confirmó el lote. Conserva esta revisión y consulta su estado antes de repetir.');
  setReview(null);setId(crypto.randomUUID());setNotice('Lote programado. Su entrega se comprobará en el dispositivo SMS.');await onSaved();
 }catch(e){setError(e instanceof Error?e.message:'No se confirmó el lote. La identidad se conserva para evitar duplicados.');}finally{setBusy(false);}}
 return <details className="rounded-lg border p-3"><summary className="cursor-pointer font-medium">Programar una lista de SMS</summary><p className="my-2 text-sm text-muted-foreground">Hasta 500 destinatarios con permiso SMS vigente. Puedes pegar teléfonos o leer un Excel. Solo texto y emojis. El intervalo y el límite diario de la SIM también se aplican.</p>
 <fieldset className="space-y-3" disabled={busy} onChange={changed}>
  <label className="block text-sm">Línea<select className={input} value={line} onChange={e=>setLine(e.target.value)}><option value="">Elige una línea SMS</option>{lines.map(l=><option key={l.line_key}>{l.line_key}</option>)}</select></label>
  <label className="block text-sm">Finalidad<select className={input} value={purpose} onChange={e=>setPurpose(e.target.value as typeof purpose)}><option value="notice">Aviso</option><option value="support">Soporte</option></select></label>
  <label className="block text-sm">Teléfonos<textarea className={input} rows={4} maxLength={200000} value={phones} onChange={e=>setPhones(e.target.value)}/></label>
  <label className="block text-sm">Leer Excel o lista<input type="file" accept=".xlsx,.csv,.txt,.tsv" className={input} onChange={e=>{const value=e.target.files?.[0];e.target.value='';if(value)void file(value);}}/></label>
  <label className="block text-sm">Texto para toda la lista<textarea className={input} rows={3} maxLength={4000} value={body} onChange={e=>setBody(e.target.value)}/></label>
  <div className="grid gap-2 sm:grid-cols-2"><label className="text-sm">Inicio · hora de Lima<input type="datetime-local" className={input} value={start} onChange={e=>setStart(e.target.value)}/></label><label className="text-sm">No enviar después de<input type="datetime-local" className={input} value={end} onChange={e=>setEnd(e.target.value)}/></label><label className="text-sm">Segundos entre destinatarios<input type="number" min={1} max={86400} className={input} value={interval} onChange={e=>setInterval(Number(e.target.value))}/></label><label className="text-sm">Destinatarios por bloque<input type="number" min={1} max={500} className={input} value={block} onChange={e=>setBlock(Number(e.target.value))}/></label><label className="text-sm">Pausa entre bloques · segundos<input type="number" min={0} max={604800} className={input} value={pause} onChange={e=>setPause(Number(e.target.value))}/></label></div>
  <button type="button" className={button} onClick={()=>void prepare()}>Revisar lista y horarios</button>
 </fieldset>
 {error&&<p role="alert" className="my-2 text-sm text-red-400">{error}</p>}{notice&&<p role="status" className="my-2 text-sm">{notice}</p>}
 {review&&<div className="mt-3 space-y-2 rounded-lg border border-amber-400 p-3"><h3 className="font-medium">{review.jobs.length} SMS para revisar</h3><p className="whitespace-pre-wrap text-sm">{review.plan.body}</p><ol className="max-h-64 overflow-y-auto text-sm">{review.jobs.map(job=><li key={job.contact_id}>{destinations[job.contact_id]} · {new Date(job.run_at).toLocaleString('es-PE',{timeZone:'America/Lima'})}</li>)}</ol><button className={button} disabled={busy} onClick={()=>void save(review.plan)}>Confirmar y programar toda la lista</button></div>}
 </details>;
}
