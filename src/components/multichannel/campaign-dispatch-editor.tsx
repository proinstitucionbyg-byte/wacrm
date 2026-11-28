'use client';
import{useCallback,useEffect,useState}from'react';
import{selectDispatchBatch,type DispatchJob}from'@/lib/multichannel/manual-dispatch';
import{CampaignDeliveryReport}from'./campaign-delivery-report';
type Line={line_key:string;linked_phone:string;ready:boolean;paused:boolean;campaign_restricted:boolean;status:string;counts:Record<string,number>};
type Data={campaign:{id:string;name:string;status:string;interval_seconds:number;block_size:number;block_pause_seconds:number;expires_at:string;body:string;sequence:{body:string;media?:{kind:string;url:string;filename?:string}}[]|null};counts:Record<string,number>;lines:Line[];pending:DispatchJob[];processing:number;checkedAt:string};
const button='rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-40';
const input='w-full rounded-lg border border-border bg-background px-3 py-2 text-sm';
export function CampaignDispatchEditor({id,onClose,onChanged}:{id:string;onClose:()=>void;onChanged:()=>void}){
 const[data,setData]=useState<Data|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 const[selected,setSelected]=useState<string[]>([]),[count,setCount]=useState(25),[unit,setUnit]=useState<'messages'|'recipients'>('messages');
 const[interval,setIntervalValue]=useState(25),[block,setBlock]=useState(25),[pause,setPause]=useState(5000),[enable,setEnable]=useState(false),[requestId,setRequestId]=useState(()=>crypto.randomUUID());
 const load=useCallback(async(initial=false)=>{try{
  const r=await fetch('/api/multichannel/campaigns/dispatch?campaign_id='+id,{cache:'no-store',signal:AbortSignal.timeout(30000)}),v=await r.json();if(!r.ok)throw Error(v.error);setData(v);setError('');
  if(initial){setIntervalValue(v.campaign.interval_seconds);setBlock(v.campaign.block_size);setPause(v.campaign.block_pause_seconds);setSelected(v.campaign.routes.map((r:{line_key:string})=>r.line_key).filter((key:string)=>v.lines.some((l:Line)=>l.line_key===key&&l.ready&&!l.campaign_restricted)));}
 }catch(e){setError(e instanceof Error?e.message:'No se pudo consultar.');}},[id]);
 useEffect(()=>{void load(true);document.getElementById('campaign-dispatch-editor')?.scrollIntoView({behavior:'smooth',block:'start'});const t=window.setInterval(()=>{if(document.visibilityState==='visible')void load();},15000);return()=>clearInterval(t);},[load]);
 const chosen=data?selectDispatchBatch(data.pending,count,unit):[];
 const needsEnable=selected.some(key=>data?.lines.some(l=>l.line_key===key&&l.paused));
 const selectionValid=selected.length>0&&selected.every(key=>data?.lines.some(l=>l.line_key===key&&l.ready&&!l.campaign_restricted));
 const editable=data?.campaign.status==='paused'&&!data.processing;
 async function pauseCampaign(){setBusy(true);setError('');try{const r=await fetch('/api/multichannel/campaigns',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'pause',campaign_id:id,value:true}),signal:AbortSignal.timeout(30000)}),v=await r.json();if(!r.ok)throw Error(v.error);await load();onChanged();setNotice('Campaña pausada. Los mensajes que ya estaban en proceso deben terminar antes de ajustar.');}catch(e){setError(e instanceof Error?e.message:'No se confirmó la pausa.');}finally{setBusy(false);}}
 async function apply(action:'save'|'send'){
  setBusy(true);setError('');setNotice('');try{
   const r=await fetch('/api/multichannel/campaigns/dispatch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({campaign_id:id,request_id:requestId,action,lines:selected,count,unit,interval,block,pause,enable_lines:enable}),signal:AbortSignal.timeout(30000)}),v=await r.json();
   if(!r.ok)throw Error(v.error||'No se confirmó el ajuste.');setRequestId(crypto.randomUUID());
   setNotice(action==='send'?`Tanda activada: ${v.messages} mensajes para ${v.recipients??'los'} destinatarios. Al terminar quedará en pausa.`:'Ajustes guardados. La campaña sigue pausada; pulsa Reanudar si deseas continuar todos los pendientes.');await load();onChanged();
  }catch(e){setError((e instanceof Error?e.message:'No se confirmó el cambio.')+' Actualiza el estado antes de repetir.');}finally{setBusy(false);}
 }
 return <section id="campaign-dispatch-editor" className="space-y-4 rounded-xl border-2 border-sky-500 bg-card p-4" aria-label="Editar envío">
  <div className="flex items-center justify-between gap-2"><h3 className="font-semibold">Editar envío · {data?.campaign.name??'Consultando…'}</h3><button type="button" className={button} onClick={onClose}>Cerrar edición</button></div>
  {error&&<p role="alert" className="text-destructive">{error}</p>}{notice&&<p role="status" className="rounded border border-sky-500 p-3">{notice}</p>}
  {data&&<>
   <div className="flex flex-wrap gap-3 text-sm"><span>Entregados: <strong>{data.counts.delivered??0}</strong></span><span>Aceptados sin acuse: <strong>{data.counts.accepted??0}</strong></span><span>Pendientes: <strong>{data.counts.queued??0}</strong></span><span>En proceso: <strong>{data.processing}</strong></span><span>Resultado incierto: <strong>{data.counts.needs_review??0}</strong></span><span>Fallidos: <strong>{data.counts.failed??0}</strong></span><span>Cancelados: <strong>{data.counts.cancelled??0}</strong></span></div>
   <p className="text-sm">Son cantidades de mensajes; una persona puede recibir imagen, texto y audio. Los ya enviados y los resultados inciertos se conservan.</p><CampaignDeliveryReport id={id} name={data.campaign.name}/>
   <details className="rounded border p-3"><summary>Ver el contenido de los pasos</summary><ol className="space-y-2">{(data.campaign.sequence??[{body:data.campaign.body}]).map((step,i)=><li key={i}><strong>Paso {i+1}</strong><p className="whitespace-pre-wrap text-sm">{step.body}</p>{step.media&&<a href={step.media.url} target="_blank" rel="noreferrer" className="text-sky-500 underline">Ver {step.media.kind}: {step.media.filename??'archivo'}</a>}</li>)}</ol></details>
   {data.campaign.status==='active'&&<button type="button" className="crm-campaign-primary-action" disabled={busy} onClick={()=>void pauseCampaign()}>Pausar para reajustar</button>}
   {!!data.processing&&<p role="status">Hay mensajes en proceso. Espera a que terminen y pulsa Actualizar estado.</p>}
   <fieldset disabled={!editable||busy} className="space-y-2"><legend className="font-semibold">1. Líneas para los próximos envíos</legend>
    {data.lines.map(l=><label key={l.line_key} className={'flex items-center gap-3 rounded border p-3 '+(!l.ready||l.campaign_restricted?'opacity-60':'')}><input type="checkbox" checked={selected.includes(l.line_key)} disabled={(!l.ready||l.campaign_restricted)&&!selected.includes(l.line_key)} onChange={e=>{setSelected(old=>e.target.checked?[...old,l.line_key]:old.filter(k=>k!==l.line_key));setRequestId(crypto.randomUUID());}}/><span className="grow"><strong>+{l.linked_phone}</strong> · {l.status}<small className="block">Entregados: {l.counts.delivered??0} · Aceptados: {l.counts.accepted??0} · Pendientes asignados: {l.counts.queued??0}</small></span></label>)}
    <p className="text-xs">Si eliges varias líneas, se reparten los destinatarios y se usan las elegidas como respaldo ante un fallo técnico.</p>
    {needsEnable&&<label className="flex gap-2 text-sm"><input type="checkbox" checked={enable} onChange={e=>setEnable(e.target.checked)}/>Habilitar el bot de las líneas conectadas que elegí y están pausadas.</label>}
   </fieldset>
   <fieldset disabled={!editable||busy} className="grid gap-3 sm:grid-cols-3"><legend className="font-semibold">2. Reajustar el ritmo</legend><label>Segundos entre mensajes<input type="number" min={1} max={86400} className={input} value={interval} onChange={e=>{setIntervalValue(Number(e.target.value));setRequestId(crypto.randomUUID());}}/></label><label>Mensajes por bloque<input type="number" min={1} max={1000} className={input} value={block} onChange={e=>{setBlock(Number(e.target.value));setRequestId(crypto.randomUUID());}}/></label><label>Pausa entre bloques · segundos<input type="number" min={0} max={604800} className={input} value={pause} onChange={e=>{setPause(Number(e.target.value));setRequestId(crypto.randomUUID());}}/></label></fieldset>
   <button type="button" className={button} disabled={busy||!editable||!selectionValid||(needsEnable&&!enable)} onClick={()=>void apply('save')}>Guardar reajustes sin enviar</button>
   <fieldset disabled={!editable||busy} className="space-y-3 rounded-xl border border-sky-500 p-3"><legend className="font-semibold">3. Enviar una tanda ahora y detenerse</legend><div className="flex gap-2"><label className="flex-1">Cantidad<input type="number" min={1} max={1000} className={input} value={count} onChange={e=>{setCount(Number(e.target.value));setRequestId(crypto.randomUUID());}}/></label><label className="flex-1">Contar por<select className={input} value={unit} onChange={e=>{setUnit(e.target.value as typeof unit);setRequestId(crypto.randomUUID());}}><option value="messages">Mensajes individuales</option><option value="recipients">Destinatarios con sus pasos pendientes</option></select></label></div>
    <p>Se enviarán <strong>{chosen.length} mensajes</strong> para <strong>{new Set(chosen.map(j=>j.contact_id)).size} destinatarios</strong>. Los demás quedarán en pausa.</p>
    <p className="text-xs">Esta tanda comienza ahora, respeta el intervalo y las esperas entre pasos, y se detiene al completar la cantidad elegida. La pausa entre bloques se aplica al guardar y reanudar todos los pendientes.</p>
    {unit==='messages'&&chosen.length>0&&data.pending.some(j=>j.predecessor_id===chosen.at(-1)?.id)&&<p className="text-sm">El límite corta una secuencia: sus pasos restantes quedarán pendientes. Elige «Destinatarios» para incluir todos sus pasos.</p>}
    <details><summary>Ver próximos mensajes de la tanda</summary><ol className="max-h-48 overflow-auto text-sm">{chosen.slice(0,100).map(j=><li key={j.id}>{j.recipient} · paso {j.campaign_step+1}</li>)}</ol>{chosen.length>100&&<p>Mostrando los primeros 100.</p>}</details>
    <button type="button" className="crm-campaign-primary-action" disabled={!selectionValid||!chosen.length||(needsEnable&&!enable)||count<1||count>1000} onClick={()=>void apply('send')}>Enviar esta tanda y pausar al terminar</button>
   </fieldset>
   <button type="button" className={button} disabled={busy} onClick={()=>void load()}>Actualizar estado</button><p className="text-xs">Actualizado: {new Date(data.checkedAt).toLocaleTimeString('es-PE',{timeZone:'America/Lima'})}. «Aceptado» todavía no confirma entrega.</p>
  </>}
 </section>;
}
