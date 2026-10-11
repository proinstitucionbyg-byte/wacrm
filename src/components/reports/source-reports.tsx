'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { quoteReportCell } from '@/lib/inbox/report-csv';
type Row = {channel:string;source_id:string;source_type:string;headline:string;conversations:number;validated_payments:number;registered_enrollments:number};
export function SourceReports() {
 const today = new Date().toLocaleDateString('en-CA',{timeZone:'America/Lima'});
 const [start,setStart]=useState(today.slice(0,7)+'-01'),[end,setEnd]=useState(today),[rows,setRows]=useState<Row[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function load() {
  setBusy(true);setError('');
  try {
   const finish=new Date(end+'T00:00:00-05:00');finish.setUTCDate(finish.getUTCDate()+1);
   const {data,error}=await createClient().rpc('source_referral_report',{p_start:new Date(start+'T00:00:00-05:00').toISOString(),p_end:finish.toISOString()});
   if(error)throw error;setRows(data??[]);
  } catch {setError('No se pudo cargar. Revisa las fechas: máximo un año.');}
  finally {setBusy(false);}
 }
 useEffect(()=>{void load();},[]); // Initial month; subsequent dates require explicit consultation.
 function exportCsv(){
  const csv='\uFEFF'+['CANAL;ID ORIGEN;TIPO;TÍTULO;CONVERSACIONES;PAGOS VALIDADOS;MATRÍCULAS REGISTRADAS',...rows.map(r=>[r.channel,r.source_id,r.source_type,r.headline,r.conversations,r.validated_payments,r.registered_enrollments].map(quoteReportCell).join(';'))].join('\r\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download=`origenes-${start}-${end}.csv`;link.click();URL.revokeObjectURL(url);
 }
 return <section className="space-y-3 border-t pt-5"><h2 className="text-xl font-bold">ORIGEN · ANUNCIO O REFERENCIA DE META</h2>
 <p className="text-sm text-muted-foreground">Solo CEO. Se conserva la primera referencia que Meta envía en cada conversación. El periodo selecciona cuándo llegó esa referencia; pagos y matrículas cuentan hasta el final del periodo, según su estado actual. No incluye conversaciones sin referencia ni reconstruye anuncios antiguos que no fueron guardados. Un título de anuncio no equivale al nombre de la campaña.</p>
 <div className="flex flex-wrap items-end gap-3"><label className="text-sm">Desde<Input type="date" value={start} onChange={e=>setStart(e.target.value)}/></label><label className="text-sm">Hasta<Input type="date" value={end} onChange={e=>setEnd(e.target.value)}/></label><Button onClick={()=>void load()} disabled={busy}>{busy?'Consultando…':'CONSULTAR'}</Button><Button variant="outline" onClick={exportCsv} disabled={busy||!rows.length}>DESCARGAR CSV</Button></div>
 {error&&<p role="alert" className="text-destructive">{error}</p>}
 <div className="overflow-auto"><table className="w-full text-sm"><thead><tr>{['Canal','ID de origen','Tipo','Título recibido','Conversaciones','Pagos validados','Matrículas registradas'].map(h=><th className="p-2 text-left" key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((r,i)=><tr className="border-t" key={i}>{[r.channel,r.source_id,r.source_type,r.headline,r.conversations,r.validated_payments,r.registered_enrollments].map((v,j)=><td key={j} className="p-2 align-top break-words">{v}</td>)}</tr>)}</tbody></table></div>
 {!busy&&!error&&!rows.length&&<p className="text-sm">No hay referencias guardadas en este periodo. Esto no significa que las conversaciones fueran orgánicas.</p>}
 </section>;
}
