'use client';

import {useCallback,useEffect,useState} from 'react';
type Line={lineKey:string;label:string;status:string;linkedPhone:string|null;active:boolean;qr:string|null};
type Registered={line_key:string;worker_id:string;linked_phone:string;paused:boolean};
type Snapshot={worker_id:string;online:boolean;lines:Line[]};
type Command={id:string;worker_id:string;status:string;result:string|null};
type Data={lines:Registered[];workers:{id:string;name:string;enabled:boolean}[];snapshots:Snapshot[];commands:Command[]};
const button='rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-40';
const labels:Record<string,string>={ready:'Conectado',stopped:'Detenido',connecting:'Conectando…',awaiting_qr:'Escanea el QR',duplicate_number:'Número ya vinculado en otra línea',wrong_number:'Revisar número',auth_failure:'No se pudo vincular',disconnected:'Desconectado',connection_error:'Error de conexión',storage_error:'Historial requiere revisión'};

export function WhatsappConnectionManager(){
 const [data,setData]=useState<Data|null>(null),[worker,setWorker]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[creating,setCreating]=useState(false),[name,setName]=useState('');
 const refresh=useCallback(async()=>{
  const response=await fetch('/api/multichannel/whatsapp/control',{cache:'no-store'});
  const body=await response.json();if(!response.ok)throw Error(body.error||'No se pudo comprobar la conexión.');
  setData(body);setError('');setWorker(current=>current||(body.workers.filter((w:{enabled:boolean})=>w.enabled).length===1?body.workers.find((w:{enabled:boolean})=>w.enabled).id:''));
 },[]);
 useEffect(()=>{let stopped=false;let timer:ReturnType<typeof setTimeout>;const poll=async()=>{try{await refresh();}catch(e){if(!stopped)setError(e instanceof Error?e.message:'No se pudo actualizar.');}if(!stopped)timer=setTimeout(poll,5000);};void poll();return()=>{stopped=true;clearTimeout(timer);};},[refresh]);
 const state=data?.snapshots.find(s=>s.worker_id===worker);
 const pending=data?.commands.find(c=>c.worker_id===worker&&['pending','running'].includes(c.status));
 const latest=data?.commands.find(c=>c.worker_id===worker);
 const online=state?.online===true&&!error;
 async function request(body:unknown){const response=await fetch('/api/multichannel/whatsapp/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const result=await response.json();if(!response.ok)throw Error(result.error||'No se pudo solicitar la acción.');return result;}
 async function manage(operation:string,line?:Line){
  if((operation==='unlink'||operation==='replace')&&!window.confirm(operation==='unlink'?`¿Desvincular +${line?.linkedPhone}? Se cerrará su vínculo con WhatsApp y se conservará el historial.`:`¿Cambiar +${line?.linkedPhone} por otro teléfono? Se abrirá un perfil nuevo; el historial anterior se conserva separado.`))return;
  setBusy(true);setNotice('');
  try{await request({action:'manage_line',worker_id:worker,operation,...(line?{line_key:line.lineKey}:{}),...(operation==='create'?{label:name.trim()}:{}),...(['unlink','replace'].includes(operation)?{expected_phone:line?.linkedPhone}:{})});setNotice('Solicitud recibida. El estado y el QR se actualizarán aquí, sin recargar la página.');if(operation==='create'){setCreating(false);setName('');}await refresh();}
  catch(e){setNotice(e instanceof Error?e.message:'No se completó la solicitud.');}finally{setBusy(false);}
 }
 async function toggleBot(line:Registered){setBusy(true);try{await request({action:'pause_line',line_key:line.line_key,value:!line.paused});setNotice(line.paused?'Automatizaciones habilitadas para este número.':'Automatizaciones pausadas para este número.');await refresh();}catch(e){setNotice(e instanceof Error?e.message:'No se pudo cambiar la pausa.');}finally{setBusy(false);}}
 return <section className="space-y-4 rounded-xl border border-border p-4" aria-label="Mis WhatsApps">
  <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-semibold">Mis WhatsApps</h2><p className="text-sm text-muted-foreground">1. Elige una línea · 2. Escanea su QR aquí · 3. Habilita sus automatizaciones</p></div><button className={button} disabled={!online||busy||!!pending} onClick={()=>setCreating(v=>!v)}>Vincular otro WhatsApp</button></div>
  <p className="text-sm text-muted-foreground">Las asesoras atienden desde Inbox. Puedes mantener hasta diez números conectados; cada uno conserva su vínculo e historial.</p>
  {data&&data.workers.filter(w=>w.enabled).length>1&&<label className="block text-sm">Computadora del bot<select className="ml-2 rounded border bg-background p-2" value={worker} onChange={e=>setWorker(e.target.value)}><option value="">Seleccionar computadora</option>{data.workers.filter(w=>w.enabled).map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></label>}
  {!data&&!error&&<p role="status">Comprobando tus WhatsApps…</p>}
  {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
  {data&&worker&&!online&&<p role="status" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">La computadora del bot está sin conexión o aún no tiene la gestión del CRM activa. En esa computadora abre <strong>ABRIR_BOT.cmd</strong>, dentro de la carpeta wacrm del Escritorio, y vuelve aquí. No necesitas copiar vínculos ni abrir otro panel para escanear.</p>}
  {notice&&<p role="status" className="text-sm">{notice}</p>}
  {pending&&<p role="status" className="text-sm">Procesando la acción solicitada. Las demás líneas mantienen su conexión.</p>}
  {latest?.result&&!pending&&<p role="status" className="text-sm">{latest.result}</p>}
  {creating&&<form className="flex flex-wrap gap-2" onSubmit={e=>{e.preventDefault();void manage('create');}}><input aria-label="Nombre del nuevo WhatsApp" className="rounded border bg-background p-2" placeholder="Ej. Soporte 2" maxLength={60} required value={name} onChange={e=>setName(e.target.value)}/><button className={button} disabled={!online||busy||!!pending||!name.trim()}>Crear y mostrar QR</button><button type="button" className={button} onClick={()=>setCreating(false)}>Cancelar</button></form>}
  <div className="grid gap-3 md:grid-cols-2">{state?.lines.map(line=>{
   const registered=data?.lines.find(r=>r.line_key===line.lineKey&&r.worker_id===worker&&r.linked_phone===line.linkedPhone);
   return <article key={line.lineKey} className="space-y-3 rounded-lg border border-border p-3"><div><h3 className="font-semibold">{line.label}</h3><p className="text-lg font-semibold tabular-nums">{line.linkedPhone?'+'+line.linkedPhone:'Teléfono por vincular'}</p><p className="text-sm">{online?(labels[line.status]??'Revisar estado'):'Sin conexión confirmada'}</p></div>
    {online&&line.status==='awaiting_qr'&&<div className="space-y-2">{line.qr?<img src={line.qr} alt={'QR para vincular '+line.label} className="h-56 w-56 rounded bg-white p-2"/>:<p role="status">Preparando el QR…</p>}<p className="text-sm">En ese celular: WhatsApp → Dispositivos vinculados → Vincular dispositivo. Escanea este QR y comprueba el número que aparece.</p></div>}
    <div className="flex flex-wrap gap-2">{!line.active&&<button className={button} disabled={!online||busy||!!pending} onClick={()=>void manage('connect',line)}>{line.linkedPhone?'Conectar vínculo guardado':'Vincular y mostrar QR'}</button>}
     {line.active&&<button className={button} disabled={!online||busy||!!pending} onClick={()=>void manage('stop',line)}>Detener sin desvincular</button>}
     {line.active&&line.status==='ready'&&line.linkedPhone&&<button className={button} disabled={!online||busy||!!pending} onClick={()=>void manage('unlink',line)}>Desvincular</button>}
     {line.linkedPhone&&<button className={button} disabled={!online||busy||!!pending} onClick={()=>void manage('replace',line)}>Cambiar número con QR nuevo</button>}
     {line.active&&line.status!=='awaiting_qr'&&<button className={button} disabled={!online||busy||!!pending} onClick={()=>void manage('recover',line)}>Revisar y recuperar</button>}
    </div>
    {registered&&<div className="flex flex-wrap items-center gap-2 border-t pt-2"><span className="text-sm">{registered.paused?'Bot en pausa':'Bot habilitado'}</span><button className={button} disabled={busy} onClick={()=>void toggleBot(registered)}>{registered.paused?'Habilitar automatizaciones':'Pausar automatizaciones'}</button></div>}
    {online&&line.status==='ready'&&!registered&&<p role="status" className="text-sm">Registrando este número en el CRM…</p>}
   </article>;
  })}</div>
 </section>;
}
