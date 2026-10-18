'use client';
import {useEffect,useState} from 'react';
import {toast} from 'sonner';
import {Button} from '@/components/ui/button';
import {ENROLLMENT_FIELDS,type EnrollmentData} from '@/lib/matriculas/enrollment';
import type {AcademicModule} from '@/lib/matriculas/calendar';
type Options={chats:{id:string;contact:{name:string|null;phone:string|null}|{name:string|null;phone:string|null}[]|null}[];sales:{user_id:string;nickname:string|null;full_name:string|null}[];calendar:AcademicModule[]};
export function ManualEnrollment({onCreated}:{onCreated:()=>void}){
  const [open,setOpen]=useState(false),[options,setOptions]=useState<Options|null>(null),[data,setData]=useState<EnrollmentData>({}),[chat,setChat]=useState(''),[sales,setSales]=useState(''),[prices,setPrices]=useState(''),[busy,setBusy]=useState(false);
  const [requestKey,setRequestKey]=useState('');
  useEffect(()=>{if(open)void fetch('/api/enrollments/manual',{cache:'no-store'}).then(async r=>{const j=await r.json();if(!r.ok)throw new Error(j.error);setOptions(j);}).catch(e=>toast.error(e.message));},[open]);
  async function submit(form:FormData){
    setBusy(true);try{
      const cuotas=prices.split(/[;\s]+/).filter(Boolean).map(v=>Number(v.replace(',','.')));
      if(cuotas.length!==6||cuotas.some(n=>!Number.isFinite(n)||n<=0))throw new Error('Indica las seis cuotas de la oferta, separadas por espacios.');
      form.set('data',JSON.stringify({...data,prices:cuotas,offer_confirmed:true}));form.set('conversation_id',chat);form.set('sales_agent_id',sales);form.set('request_key',requestKey);
      const response=await fetch('/api/enrollments/manual',{method:'POST',body:form});const result=await response.json();if(!response.ok)throw new Error(result.error);
      toast.success('Ingreso guardado. Revisa los datos extraidos. El CEO debe validar el voucher antes del registro y los documentos.');setOpen(false);setData({});setPrices('');onCreated();
    }catch(error){toast.error(error instanceof Error?error.message:'No se pudo guardar');}finally{setBusy(false);}
  }
  return <div className="space-y-3"><Button onClick={()=>{if(!open)setRequestKey(crypto.randomUUID());setOpen(!open);}} variant="outline">{open?'Cerrar ingreso manual':'+ Ingresar estudiante desde el CRM'}</Button>{open&&<form action={submit} className="space-y-4 rounded-xl border border-border bg-card p-4">
    <h2 className="font-semibold">NUEVO INGRESO MANUAL</h2><p className="text-sm text-muted-foreground">No asignes un numero de matricula. Se asignara al registrar en la misma cola automatica, despues de validar el pago.</p>
    <label className="block text-sm">Chat del estudiante<select required value={chat} onChange={e=>setChat(e.target.value)} className="mt-1 w-full rounded border border-border bg-background p-2"><option value="">Selecciona el chat</option>{options?.chats.map(c=>{const p=Array.isArray(c.contact)?c.contact[0]:c.contact;return <option key={c.id} value={c.id}>{p?.name||'Sin nombre'} — {p?.phone||c.id}</option>;})}</select></label>
    <label className="block text-sm">Asesora que realizo la venta<select required value={sales} onChange={e=>setSales(e.target.value)} className="mt-1 w-full rounded border border-border bg-background p-2"><option value="">Selecciona la asesora</option>{options?.sales.map(p=><option key={p.user_id} value={p.user_id}>{p.nickname||p.full_name||p.user_id}</option>)}</select></label>
    <div className="grid gap-3 sm:grid-cols-2">{Object.entries(ENROLLMENT_FIELDS).map(([key,label])=><label key={key} className="block text-xs">{label}<input type={['birth_date','start_date','payment_date'].includes(key)?'date':key==='email'?'email':'text'} value={data[key as keyof typeof ENROLLMENT_FIELDS]??''} onChange={e=>setData({...data,[key]:e.target.value})} maxLength={250} className="mt-1 w-full rounded border border-border bg-background p-2"/></label>)}</div>
    <label className="block text-sm">Inicio oficial<select value={data.start_date&&data.course?`${data.course}|${data.start_date}`:''} onChange={e=>{const [course,start_date]=e.target.value.split('|');setData({...data,course,start_date});}} className="mt-1 w-full rounded border border-border bg-background p-2"><option value="">Usar el cuadro de inicios</option>{options?.calendar.map(m=><option key={`${m.course}:${m.start_date}`} value={`${m.course}|${m.start_date}`}>{m.course} — {m.module} — {m.start_date}</option>)}</select></label>
    <label className="block text-sm">Seis cuotas de la oferta (primera cuota y cinco pensiones)<input required value={prices} onChange={e=>setPrices(e.target.value)} placeholder="Importes separados por espacios" className="mt-1 w-full rounded border border-border bg-background p-2"/></label>
    <div className="grid gap-3 sm:grid-cols-2">{[['front','DNI / CE: primera cara'],['back','DNI / CE: segunda cara'],['voucher','Voucher de pago (obligatorio)'],['declaration','Sin documento: pantallazo con los datos escritos del estudiante'],['guardian','Documento del tutor, si corresponde']].map(([name,label])=><label key={name} className="block text-xs">{label}<input type="file" name={name} required={name==='voucher'} accept="image/jpeg,image/png,image/webp" className="mt-1 w-full text-sm"/></label>)}</div>
    <p className="text-xs text-muted-foreground">Se leen las imagenes para sugerir datos. Comprueba la identidad y la oferta antes de continuar. La aprobacion del pago corresponde al CEO.</p>
    <Button type="submit" disabled={busy||!options}>{busy?'Guardando y leyendo documentos…':'Guardar ingreso para validacion'}</Button>
  </form>}</div>;
}
