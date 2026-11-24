'use client';
import {useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {ENROLLMENT_FIELDS,type EnrollmentDraft} from '@/lib/matriculas/enrollment';
import type {CorrectionPlan,CorrectionScope} from '@/lib/matriculas/registered-correction';
type Field=keyof typeof ENROLLMENT_FIELDS;
type History={id:string;status:string;reason:string;created_at:string};
const input='w-full min-w-0 rounded-md border bg-background p-2 text-sm';
export function RegisteredCorrectionEditor({enrollmentId}:{enrollmentId:string}){
 const [open,setOpen]=useState(false),[draft,setDraft]=useState<EnrollmentDraft|null>(null),[history,setHistory]=useState<History[]>([]);
 const [field,setField]=useState<Field>('full_name'),[patch,setPatch]=useState<Partial<Record<Field,string>>>({}),[scope,setScope]=useState<CorrectionScope>('linked');
 const [reason,setReason]=useState(''),[confirmed,setConfirmed]=useState(false),[plan,setPlan]=useState<CorrectionPlan|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const requestId=useRef<string|null>(null);
 useEffect(()=>{
  if(!open)return;const abort=new AbortController();setBusy(true);setError('');setPlan(null);setConfirmed(false);
  async function load(){
   const responses=await Promise.all([fetch(`/api/enrollments/${enrollmentId}`,{cache:'no-store',signal:abort.signal}),fetch(`/api/enrollments/${enrollmentId}/revisions`,{cache:'no-store',signal:abort.signal})]);
   const values=await Promise.all(responses.map(r=>r.json()));
   for(let i=0;i<responses.length;i++)if(!responses[i].ok)throw Error(values[i].error||'No se pudo consultar la ficha.');
   if(!abort.signal.aborted){setDraft(values[0].draft);setHistory(values[1].requests??[]);}
  }
  void load().catch(e=>{if(!abort.signal.aborted)setError(e instanceof Error?e.message:'No se pudo consultar.');}).finally(()=>{if(!abort.signal.aborted)setBusy(false);});
  return()=>abort.abort();
 },[open,enrollmentId]);
 function invalidate(){setPlan(null);setConfirmed(false);setMessage('');requestId.current=null;}
 async function submit(action:'preview'|'request'){
  if(!draft)return;setBusy(true);setError('');setMessage('');
  try{
   if(action==='request'&&!requestId.current)requestId.current=crypto.randomUUID();
   const response=await fetch(`/api/enrollments/${enrollmentId}/revisions`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,version:draft.version,scope,patch,reason,confirmed,request_id:requestId.current})});
   const value=await response.json();if(!response.ok)throw Error(value.error||'No se pudo preparar la corrección.');
   if(action==='preview')setPlan(value.plan);else{setHistory(old=>[value.request,...old.filter(item=>item.id!==value.request.id)]);setMessage(value.message);setConfirmed(false);}
  }catch(e){setError(e instanceof Error?e.message:'No se pudo preparar la corrección.');}finally{setBusy(false);}
 }
 const active=history.find(item=>['requested','processing','review'].includes(item.status));
 const labels:Record<string,string>={requested:'Solicitud pendiente de aplicar',processing:'Reproceso en curso',review:'Requiere revisión',completed:'Corrección completada',cancelled:'Solicitud cancelada'};
 return <><Button type="button" size="sm" variant="outline" onClick={()=>setOpen(true)}>Corregir datos</Button>
 <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[88dvh] overflow-y-auto p-3 sm:max-w-xl sm:p-5"><DialogHeader className="pr-7"><DialogTitle>Corregir matrícula registrada</DialogTitle><DialogDescription>Revisa el cambio y elige dónde debe aplicarse. Se conserva el historial.</DialogDescription></DialogHeader>
 {error&&<p role="alert" className="rounded border border-destructive p-2 text-sm text-destructive">{error}</p>}
 {message&&<p role="status" className="rounded border border-sky-500 p-2 text-sm">{message}</p>}
 {active?<section className="space-y-2 rounded border p-3 text-sm"><strong>{labels[active.status]}</strong><p>{active.reason}</p><p>La solicitud guardada no confirma que los datos, documentos o certificados ya estén corregidos. Revisa el resultado de cada parte antes de dar el trámite por terminado.</p></section>:draft?.status==='registered'?<div className="space-y-3">
 <label className="block text-sm">Dato que quieres corregir<select className={input+' mt-1'} value={field} disabled={busy} onChange={e=>setField(e.target.value as Field)}>{Object.entries(ENROLLMENT_FIELDS).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
 <p className="break-words text-xs text-muted-foreground">Actual: {draft.data[field]||'Sin dato'}</p>
 <label className="block text-sm">Valor correcto<input className={input+' mt-1'} type={['birth_date','start_date','payment_date'].includes(field)?'date':field==='email'?'email':'text'} value={patch[field]??draft.data[field]??''} disabled={busy} maxLength={500} onChange={e=>{invalidate();setPatch(old=>({...old,[field]:e.target.value}));}}/></label>
 {Object.keys(patch).length>0&&<p className="text-xs">Datos preparados: {Object.keys(patch).map(key=>ENROLLMENT_FIELDS[key as Field]).join(', ')}. Puedes elegir otro dato arriba.</p>}
 <label className="block text-sm">¿Dónde se modifica?<select className={input+' mt-1'} value={scope} disabled={busy} onChange={e=>{invalidate();setScope(e.target.value as CorrectionScope);}}><option value="linked">Actualizar registros y documentos vinculados</option><option value="crm">Solo en la ficha del CRM</option></select></label>
 <Button type="button" variant="outline" disabled={busy||!Object.keys(patch).length} onClick={()=>void submit('preview')}>Revisar qué cambiará</Button>
 {plan&&<section className="space-y-2 rounded border p-3 text-sm"><h3 className="font-semibold">Cambios preparados · todavía no aplicados</h3>{plan.changes.map(change=><p key={change.field} className="break-words"><strong>{change.label}</strong><br/>{change.before||'Vacío'} → {change.after||'Vacío'}</p>)}{plan.targets.map(target=><p key={target.target}><strong>{target.target==='crm'?'CRM':target.target==='sheet'?'Hoja de matrículas':target.target==='folder'?'Carpeta':target.target==='certificates'?'Certificados':target.target}</strong>: {target.explanation}</p>)}{plan.warnings.map(warning=><p key={warning} className="text-amber-600 dark:text-amber-400">{warning}</p>)}
 <label className="block">Motivo<textarea className={input+' mt-1'} rows={2} value={reason} maxLength={1000} disabled={busy} onChange={e=>{setReason(e.target.value);setConfirmed(false);requestId.current=null;}}/></label>
 <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/><span>Revisé los datos y el alcance. Entiendo que guardar la solicitud todavía no modifica los documentos.</span></label>
 <Button type="button" className="w-full" disabled={busy||!confirmed||reason.trim().length<10} onClick={()=>void submit('request')}>Guardar solicitud de corrección</Button></section>}
 </div>:!busy&&<p className="text-sm">Esta opción corresponde a una matrícula ya registrada.</p>}
 {busy&&<p role="status" className="text-sm">Consultando…</p>}
 </DialogContent></Dialog></>;
}
