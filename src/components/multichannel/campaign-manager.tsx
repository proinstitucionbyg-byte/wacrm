'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import {LiveCampaignManager} from './live-campaign-manager';
import {SessionLineManager} from './session-line-manager';
import type { previewCampaign } from '@/lib/multichannel/campaign-preview';
import type { previewCentralCampaign } from '@/lib/multichannel/central-campaign';
import { parseRecipientList, limaInputToISO, remainingRecipientList } from '@/lib/multichannel/recipient-list';
import { CENTRAL_SPREADSHEET_ID, COMMUNICATION_HEADERS, parseCentralTable } from '@/lib/multichannel/central-source';

type Preview = ReturnType<typeof previewCampaign> | ReturnType<typeof previewCentralCampaign>;
type QueueJob = {id:string;recipient:string;status:string;run_at:string;body:string};
type QueueLine = {line_key:string;channel:'sms'|'whatsapp_support';paused:boolean;available:boolean};
const labels:Record<string,string>={ready:'Listo para prueba',blocked:'Revisar',duplicate:'Repetido',deferred:'Otro lote',
  queued:'Pendiente',claimed:'Reservado',dispatching:'En proceso',simulated:'Simulado',needs_review:'Revisión pendiente',expired:'Vencido',cancelled:'Cancelado'};
const style='w-full rounded-lg border border-border bg-background px-3 py-2 text-sm';
const button='rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-40';
const when=(date:string)=>new Date(date).toLocaleString('es-PE',{timeZone:'America/Lima',dateStyle:'short',timeStyle:'short'});
const currentLimaMonth=()=>{const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Lima',year:'numeric',month:'2-digit'}).formatToParts(new Date());return `${parts.find(p=>p.type==='year')?.value}-${parts.find(p=>p.type==='month')?.value}`;};
const displayError=(error:unknown,fallback:string)=>error instanceof Error && error.name==='Error'?error.message:fallback;

export function CampaignManager() {
  const [source,setSource]=useState<'manual'|'central'>('manual');
  const [centralList,setCentralList]=useState(COMMUNICATION_HEADERS.join('\t')+'\n');
  const [campaign,setCampaign]=useState('');
  const [version,setVersion]=useState(1);
  const [purpose,setPurpose]=useState('notice');
  const [channel,setChannel]=useState<'sms'|'whatsapp_support'>('sms');
  const [line,setLine]=useState('TEST-linea-1');
  const [start,setStart]=useState(''); const [end,setEnd]=useState('');
  const [interval,setInterval]=useState(20); const [limit,setLimit]=useState(100);
  const [template,setTemplate]=useState('Hola {{nombre}}, este es un aviso de prueba.');
  const [list,setList]=useState('ID\tDestino\tNombre\tPermiso\tPago\n');
  const [preview,setPreview]=useState<Preview|null>(null);
  const [error,setError]=useState(''); const [notice,setNotice]=useState('');
  const [busy,setBusy]=useState(false); const [saved,setSaved]=useState(false);
  const [jobs,setJobs]=useState<QueueJob[]|null>(null); const [queueError,setQueueError]=useState('');
  const [loadingQueue,setLoadingQueue]=useState(false);
  const [cancellingJobId,setCancellingJobId]=useState('');
  const [calendarMonth,setCalendarMonth]=useState(currentLimaMonth);
  const [calendarPage,setCalendarPage]=useState(0);
  const [calendarHasMore,setCalendarHasMore]=useState(false);
  const [queueView,setQueueView]=useState<'list'|'calendar'>('list');
  const [lines,setLines]=useState<QueueLine[]|null>(null);
  const [lineBusy,setLineBusy]=useState(false); const [lineNotice,setLineNotice]=useState('');
  const [page,setPage]=useState(0);

  function changed() {setPreview(null);setSaved(false);setError('');setNotice('');setPage(0);}
  function nextBatch() {
    if(source!=='manual'||!saved||!preview?.totals.deferred) return;
    try {
      const remaining=remainingRecipientList(list,preview.rows.filter(r=>r.status==='deferred'));
      const last=preview.jobs.at(-1);
      const next=last?Math.ceil((Date.parse(last.run_at)+interval*1000)/60000)*60000:null;
      changed();setList(remaining);
      if(next) setStart(new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Lima',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(next)).replace(' ','T'));
      setNotice('Siguiente lote preparado. Revisa sus destinatarios y horario antes de guardarlo.');
    }catch(err){setError(displayError(err,'No se pudo preparar el siguiente lote.'));}
  }
  function example() {
    const campaignId=`ejemplo-${Date.now()}`;
    changed();setCampaign(campaignId);setPurpose(source==='central'?'notice':'collection');setVersion(1);
    setLine('TEST-linea-1');setInterval(20);setLimit(100);
    const date=(delta:number)=>new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Lima',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(Date.now()+delta)).replace(' ','T');
    const startValue=date(3600000);
    setStart(startValue);setEnd(date(7200000));
    setTemplate('Hola {{nombre}}, este es un recordatorio ficticio.');
    setList('ID\tDestino\tNombre\tPermiso\tPago\nalumno-1\tTEST-alumno-1\tAlumno de prueba\tSí\tPendiente\nalumno-2\tTEST-alumno-2\tPago de prueba resuelto\tSí\tResuelto\nalumno-1\tTEST-alumno-1\tRepetido\tSí\tPendiente');
    const sample=(record:Record<string,string>)=>COMMUNICATION_HEADERS.map(h=>record[h]??'').join('\t');
    const first={Comunicacion_ID:'COM-prueba-1',Estudiante_ID:'EST-prueba-1',Finalidad:'Aviso',Canal:channel==='sms'?'SMS':'WhatsApp soporte',
      'Fecha prevista':startValue,Destino:'TEST-alumno-1','Consentimiento / permiso':'Sí',
      'Texto / plantilla':'Aviso ficticio de tu curso.',Estado:'Programado',Campana_ID:campaignId,Intentos:'0'};
    setCentralList([COMMUNICATION_HEADERS.join('\t'),sample(first),
      sample({...first,Comunicacion_ID:'COM-prueba-2',Estudiante_ID:'EST-prueba-2',Destino:'TEST-alumno-2',Estado:'Enviado manualmente'}),
      sample({...first,Comunicacion_ID:'COM-prueba-3'})].join('\n'));
  }
  async function prepare(event:FormEvent) {
    event.preventDefault();setBusy(true);setError('');setNotice('');setPreview(null);setSaved(false);
    try {
      const settings={
        campaign_id:campaign,version,purpose,channel,line_key:line,run_at:limaInputToISO(start),expires_at:limaInputToISO(end),
        interval_seconds:interval,batch_limit:limit,
      };
      const payload=source==='central'?{source:'central-sheet',spreadsheet_id:CENTRAL_SPREADSHEET_ID,
        sheet_name:'COMUNICACIONES',text_mode:'literal',...parseCentralTable(centralList),campaign:settings}
        :{...settings,template,recipients:parseRecipientList(list)};
      const response=await fetch('/api/multichannel/preview',{method:'POST',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      const result=await response.json();
      if(!response.ok) throw new Error(typeof result.error==='string'?result.error:'Revisa los campos, fechas y destinatarios de la campaña.');
      setPreview(result);
    }catch(err){setError(displayError(err,'No se pudo preparar la campaña. Revisa la conexión e inténtalo nuevamente.'));}
    finally{setBusy(false);}
  }
  async function loadQueue(month?:string,page=0,append=false) {
    setLoadingQueue(true);setQueueError('');
    if(!append){setJobs(null);setCalendarPage(0);setCalendarHasMore(false);}
    try {
      const path=month?`/api/multichannel/control?month=${encodeURIComponent(month)}&page=${page}`:'/api/multichannel/control';
      const response=await fetch(path,{cache:'no-store',signal:AbortSignal.timeout(15000)});const result=await response.json();
      if(!response.ok) throw new Error(typeof result.error==='string'?result.error:'No se pudo consultar la cola.');
      setJobs(previous=>append&&month?[...(previous??[]),...result.jobs]:result.jobs);
      setCalendarPage(result.calendarPage??0);
      setCalendarHasMore(result.calendarHasMore===true);
      setLines(result.lines ?? null);
    }catch(err){setLines(null);setQueueError(displayError(err,'No se pudo consultar la cola. Revisa la conexión.'));}
    finally{setLoadingQueue(false);}
  }
  async function controlLine(action:'register_line'|'pause_line'|'set_line_availability', lineKey:string, value?:boolean, lineChannel:'sms'|'whatsapp_support'=channel) {
    setLineBusy(true);setQueueError('');setLineNotice('');
    try {
      const response=await fetch('/api/multichannel/control',{method:'POST',signal:AbortSignal.timeout(15000),
        headers:{'Content-Type':'application/json'},body:JSON.stringify({action,line_key:lineKey,
          ...(action==='register_line'?{channel:lineChannel}:{value})})});
      const result=await response.json();
      if(!response.ok) throw new Error(typeof result.error==='string'?result.error:'No se pudo actualizar la línea.');
      setLineNotice(action==='register_line'?'Registro comprobado. Registrar de nuevo conserva las pausas y la disponibilidad existentes.':'Cambio de línea guardado. Un intento ya iniciado conserva su resultado.');
      await loadQueue();
    }catch(err){setLines(null);setQueueError(displayError(err,'No se pudo confirmar el cambio. Consulta las líneas antes de repetir.'));}
    finally{setLineBusy(false);}
  }
  async function save() {
    if(!preview?.jobs.length || saved) return;
    setBusy(true);setError('');setNotice('');
    try {
      const response=await fetch('/api/multichannel/control',{method:'POST',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'enqueue_batch',jobs:preview.jobs})});
      const result=await response.json();
      if(!response.ok) throw new Error(typeof result.error==='string'?result.error:'No se guardó el lote.');
      setSaved(true);setNotice(`${result.enqueued} trabajos guardados para simulación. No se enviaron mensajes.`);
      await loadQueue();
    }catch(err){setError(displayError(err,'No se pudo confirmar el guardado; consulta la cola antes de repetir.'));}
    finally{setBusy(false);}
  }
  async function cancelJob(jobId:string) {
    setCancellingJobId(jobId);setQueueError('');setLineNotice('');
    try {
      const response=await fetch('/api/multichannel/control',{method:'POST',signal:AbortSignal.timeout(15000),
        headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'cancel_job',job_id:jobId})});
      const result=await response.json();
      if(!response.ok) throw new Error(typeof result.error==='string'?result.error:'No se pudo cancelar el trabajo.');
      setLineNotice('Trabajo cancelado y conservado en el historial.');
      await loadQueue();
    }catch(err){setQueueError(displayError(err,'No se pudo confirmar la cancelación. Actualiza la cola antes de repetir.'));}
    finally{setCancellingJobId('');}
  }
  const calendarDays=Object.entries((jobs??[]).reduce<Record<string,QueueJob[]>>((days,job)=>{
    const day=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Lima',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(job.run_at));
    (days[day]??=[]).push(job);return days;
  },{})).sort(([a],[b])=>a.localeCompare(b));
  return <div className="mx-auto w-full max-w-6xl space-y-5 p-4 sm:p-6">
    <SessionLineManager/>
    <LiveCampaignManager/>
    <header className="space-y-2"><h1 className="text-xl font-semibold">Bot multicanal</h1>
      <p className="text-sm text-muted-foreground">Prepara campañas y revisa sus pendientes.</p>
      <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">Modo de prueba. Esta pantalla prepara simulaciones; no envía SMS ni WhatsApp. La conexión de los teléfonos se comprueba por separado.</p>
    </header>
    <form onSubmit={prepare} className="space-y-4" onChange={changed}>
      <fieldset disabled={busy} className="space-y-4 rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">1. Preparar campaña</h2><button type="button" className={button} onClick={example}>Cargar ejemplo ficticio</button></div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="space-y-1 text-sm">Origen de los destinatarios<select className={style} value={source} onChange={e=>setSource(e.target.value as 'manual'|'central')}><option value="manual">Lista manual</option><option value="central">Base central · COMUNICACIONES</option></select></label>
          <label className="space-y-1 text-sm">Nombre / ID estable<input required maxLength={100} className={style} value={campaign} onChange={e=>setCampaign(e.target.value)}/></label>
          <label className="space-y-1 text-sm">Finalidad<select className={style} value={purpose} onChange={e=>setPurpose(e.target.value)}><option value="notice">Aviso</option><option value="collection">Cobranza de prueba</option></select></label>
          <label className="space-y-1 text-sm">Canal de prueba<select className={style} value={channel} onChange={e=>setChannel(e.target.value as 'sms'|'whatsapp_support')}><option value="sms">SMS · simulación</option><option value="whatsapp_support">WhatsApp de soporte · simulación</option></select><span className="text-xs text-muted-foreground">No conecta ni envía desde un teléfono. La fila de COMUNICACIONES debe indicar el mismo canal.</span></label>
          <label className="space-y-1 text-sm">Línea de prueba<input required list="test-lines" pattern="TEST-[A-Za-z0-9_-]{1,60}" className={style} value={line} onChange={e=>setLine(e.target.value)}/><datalist id="test-lines">{[1,2,3].map(n=><option key={n} value={`TEST-linea-${n}`}/>)}</datalist><span className="text-xs text-muted-foreground">Agrega otra con un identificador TEST-…; no hay límite de tres líneas.</span></label>
          <label className="space-y-1 text-sm">Inicio · hora de Lima<input required type="datetime-local" className={style} value={start} onChange={e=>setStart(e.target.value)}/></label>
          <label className="space-y-1 text-sm">Vencimiento · hora de Lima<input required type="datetime-local" className={style} value={end} onChange={e=>setEnd(e.target.value)}/></label>
          <label className="space-y-1 text-sm">Máximo de destinatarios<input required type="number" min={1} max={500} className={style} value={limit} onChange={e=>setLimit(Number(e.target.value))}/></label>
        </div>
        <details className="rounded-lg border border-border p-3"><summary className="cursor-pointer text-sm">Ajustes de simulación</summary><div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm">Segundos entre trabajos<input required type="number" min={1} max={86400} className={style} value={interval} onChange={e=>setInterval(Number(e.target.value))}/></label>
          <label className="text-sm">Versión de campaña<input required type="number" min={1} className={style} value={version} onChange={e=>setVersion(Number(e.target.value))}/></label>
        </div><p className="mt-2 text-xs text-muted-foreground">Cambiar la versión crea otra campaña de envíos. No la cambies para saltar un aviso de duplicado. Los intervalos de prueba no garantizan límites de una operadora.</p></details>
        {source==='manual'?<>
          <label className="block space-y-1 text-sm">Texto<textarea required rows={3} maxLength={4000} className={style} value={template} onChange={e=>setTemplate(e.target.value)}/><span className="text-xs text-muted-foreground">Usa {'{{nombre}}'} para personalizar el saludo.</span></label>
          <label className="block space-y-1 text-sm">Lista de destinatarios<textarea required rows={5} spellCheck={false} className={`${style} font-mono text-xs`} value={list} onChange={e=>setList(e.target.value)}/></label>
          <p className="text-xs text-muted-foreground">Pega cinco columnas desde Excel: ID, Destino, Nombre, Permiso y Pago. Permiso: Sí / No / Pendiente. Pago: Pendiente / Resuelto / Por confirmar. Hasta 5000 filas, en lotes de máximo 500; solo destinos TEST-… pueden pasar a la cola de prueba.</p>
        </>:<>
          <label className="block space-y-1 text-sm">Filas de COMUNICACIONES<textarea required rows={5} spellCheck={false} className={`${style} font-mono text-xs`} value={centralList} onChange={e=>setCentralList(e.target.value)}/></label>
          <p className="text-xs text-muted-foreground">Copia la cabecera A4:Q4 y las filas del maestro central. Se revisan solo las que coincidan con el ID y la fecha de esta campaña. La columna Texto / plantilla debe contener el texto final, con sus variables ya completadas.</p>
          <p className="text-xs text-muted-foreground">Se excluyen filas ya enviadas o con intentos previos. Las cobranzas requieren conciliación de saldos y quedan en revisión. Importar esta tabla no modifica la hoja ni consulta el CRM.</p>
        </>}
        <button disabled={busy} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">{busy?'Procesando…':'2. Revisar destinatarios'}</button>
      </fieldset>
    </form>
    {error&&<p role="alert" className="rounded-lg border border-red-500/40 p-3 text-sm text-red-500">{error}</p>}
    {notice&&<p role="status" className="rounded-lg border border-emerald-500/40 p-3 text-sm">{notice}</p>}
    {preview&&<section className="space-y-3 rounded-xl border border-border bg-card p-4">
      <h2 className="font-semibold">2. Resultado de la revisión</h2>
      <div className="flex flex-wrap gap-2 text-sm">{Object.entries({Recibidos:preview.totals.received,Listos:preview.totals.ready,Revisar:preview.totals.blocked,Repetidos:preview.totals.duplicate,'Otro lote':preview.totals.deferred}).map(([key,value])=><span key={key} className="rounded-lg bg-muted px-3 py-2">{key}: <strong>{value}</strong></span>)}</div>
      <div className="max-h-80 overflow-auto rounded-lg border border-border"><table className="w-full text-left text-xs"><thead className="sticky top-0 bg-card"><tr>{['Destino','Estado','Motivo / texto','Hora Lima'].map(title=><th key={title} className="p-2">{title}</th>)}</tr></thead><tbody>{preview.rows.slice(page*50,(page+1)*50).map((row,index)=><tr key={`${row.recipient_id}-${page}-${index}`} className="border-t border-border"><td className="break-all p-2">{row.destination}</td><td className="p-2">{labels[row.status]}</td><td className="min-w-40 p-2">{row.reason}{row.body&&<p className="mt-1 whitespace-pre-wrap text-muted-foreground">{row.body}</p>}</td><td className="p-2">{row.run_at?when(row.run_at):'—'}</td></tr>)}</tbody></table></div>
      <div className="flex flex-wrap items-center gap-2 text-xs"><button type="button" className={button} disabled={!page||busy} onClick={()=>setPage(page-1)}>Anterior</button><span>Página {page+1} de {Math.max(1,Math.ceil(preview.rows.length/50))}</span><button type="button" className={button} disabled={busy||(page+1)*50>=preview.rows.length} onClick={()=>setPage(page+1)}>Siguiente</button></div>
      <button type="button" disabled={busy||saved||!preview.jobs.length} onClick={save} className={button}>{saved?'Lote de prueba guardado':'3. Guardar solo los listos en la cola de prueba'}</button>
      {source==='manual'&&saved&&preview.totals.deferred>0&&<button type="button" disabled={busy} className={`${button} ml-2`} onClick={nextBatch}>Preparar siguiente lote</button>}
      {source==='central'&&preview.totals.deferred>0&&<p className="text-xs text-muted-foreground">Hay filas para otro lote. Consérvalas en COMUNICACIONES y revisa su próximo horario antes de prepararlas.</p>}
      <p className="text-xs text-muted-foreground">Revisar no guarda. Guardar requiere que la base de simulación esté configurada; nunca activa envíos reales.</p>
    </section>}
    <section className="space-y-3 rounded-xl border border-border bg-card p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">Líneas y cola de prueba</h2><button type="button" disabled={loadingQueue||busy||lineBusy} className={button} onClick={()=>{void loadQueue()}}>{loadingQueue?'Consultando…':'Consultar pendientes e historial'}</button></div>
      {queueError&&<p role="alert" className="text-sm text-amber-600">{queueError} La revisión de campañas sigue disponible.</p>}
      <p className="text-sm">Una línea nueva queda pausada y no disponible. Para simular, marca su disponibilidad y reanúdala. Estos controles todavía no comprueban la conexión del teléfono.</p>
      <button type="button" className={button} disabled={busy||loadingQueue||lineBusy} onClick={()=>controlLine('register_line',line,undefined,channel)}>Registrar línea {channel==='sms'?'SMS':'WhatsApp soporte'} de prueba: {line}</button>
      {lineNotice&&<p role="status" className="text-sm">{lineNotice}</p>}
      {lines&&<div className="space-y-2"><h3 className="text-sm font-medium">Líneas registradas · primeras 100</h3>{lines.map(item=><div key={item.line_key} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3 text-sm">
        <span className="break-all font-medium">{item.line_key}</span><span>{item.channel==='sms'?'SMS':'WhatsApp de soporte · simulación'}</span>
        <span>{item.paused?'Pausada':'Reanudada'} · {item.available?'Disponible para prueba':'No disponible'}</span>
        <button type="button" className={button} disabled={busy||loadingQueue||lineBusy} onClick={()=>controlLine('pause_line',item.line_key,!item.paused)} aria-label={`${item.paused?'Reanudar simulación en':'Pausar'} ${item.line_key}`}>{item.paused?'Reanudar simulación':'Pausar'}</button>
        <button type="button" className={button} disabled={busy||loadingQueue||lineBusy} onClick={()=>controlLine('set_line_availability',item.line_key,!item.available)} aria-label={`Marcar ${item.line_key} ${item.available?'no disponible':'disponible para prueba'}`}>{item.available?'Marcar no disponible':'Marcar disponible para prueba'}</button>
      </div>)}{!lines.length&&<p className="text-sm">No hay líneas registradas; los trabajos permanecerán pendientes hasta habilitar una.</p>}</div>}
      {jobs&&<div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-medium">{queueView==='calendar'?`Calendario de prueba · ${calendarMonth}`:'Programación de prueba · últimos 100 trabajos'}</h3><div className="flex gap-2"><button type="button" className={button} disabled={loadingQueue} aria-pressed={queueView==='list'} onClick={()=>{setQueueView('list');void loadQueue();}}>Lista</button><button type="button" className={button} disabled={loadingQueue} aria-pressed={queueView==='calendar'} onClick={()=>{setQueueView('calendar');void loadQueue(calendarMonth);}}>Calendario</button></div></div>}
      {jobs&&queueView==='list'&&<div className="max-h-64 overflow-auto"><table className="w-full text-left text-xs"><thead><tr><th className="p-2">Destino</th><th className="p-2">Estado</th><th className="p-2">Hora Lima</th><th className="p-2">Acción</th></tr></thead><tbody>{jobs.map(job=><tr key={job.id} className="border-t border-border"><td className="p-2">{job.recipient}</td><td className="p-2">{labels[job.status]??job.status}</td><td className="p-2">{when(job.run_at)}</td><td className="p-2">{job.status==='queued'&&<button type="button" className={button} disabled={busy||loadingQueue||lineBusy||!!cancellingJobId} onClick={()=>cancelJob(job.id)}>{cancellingJobId===job.id?'Cancelando…':'Cancelar'}</button>}</td></tr>)}</tbody></table>{!jobs.length&&<p className="p-2 text-sm">No hay trabajos guardados.</p>}</div>}
      {jobs&&queueView==='calendar'&&<div className="max-h-64 space-y-3 overflow-auto"><div className="flex flex-wrap items-end gap-2"><label className="space-y-1 text-sm">Mes · hora de Lima<input type="month" className={style} value={calendarMonth} onChange={e=>{setCalendarMonth(e.target.value);void loadQueue(e.target.value)}}/></label><button type="button" className={button} disabled={loadingQueue||!calendarMonth} onClick={()=>{void loadQueue(calendarMonth)}}>{loadingQueue?'Consultando…':'Consultar mes'}</button></div>{calendarDays.map(([day,items])=><section key={day} className="rounded-lg border border-border p-3"><div className="flex justify-between text-sm font-medium"><h4>{new Intl.DateTimeFormat('es-PE',{timeZone:'America/Lima',weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(new Date(`${day}T12:00:00-05:00`))}</h4><span>{items.length} {items.length===1?'trabajo':'trabajos'}</span></div><ul className="mt-2 space-y-1 text-xs">{items.sort((a,b)=>a.run_at.localeCompare(b.run_at)).map(job=><li key={job.id} className="flex flex-wrap justify-between gap-2 border-t border-border py-2"><span>{when(job.run_at)} · {job.recipient}</span><span>{labels[job.status]??job.status}</span></li>)}</ul></section>)}{calendarHasMore&&<button type="button" className={button} disabled={loadingQueue} onClick={()=>{void loadQueue(calendarMonth,calendarPage+1,true)}}>{loadingQueue?'Cargando…':'Cargar siguientes 500'}</button>}{!calendarDays.length&&<p className="p-2 text-sm">No hay horarios guardados para este mes.</p>}<p className="text-xs text-muted-foreground">Trabajos de la cola de prueba, filtrados por el mes elegido y agrupados en hora de Lima. No sincroniza ni envía desde el calendario.</p></div>}
      <p className="text-xs text-muted-foreground">Actualización manual. Simulado significa prueba completada; no significa SMS entregado.</p>
    </section>
  </div>;
}
