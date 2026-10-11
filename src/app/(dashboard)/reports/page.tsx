'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { quoteReportCell } from '@/lib/inbox/report-csv';
import { CaseReports } from '@/components/reports/case-reports';
type Count={direction:string;quantity:number;phrase?:string;word?:string};
type Report={period_kind:string;period_start:string;period_end:string;phrases:Count[];words:Count[]};

export default function ReportsPage(){
 const {accountRole,accountId}=useAuth();
 const [rows,setRows]=useState<Report[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(true),[filter,setFilter]=useState(''),[mode,setMode]=useState<'phrases'|'words'>('phrases');
 useEffect(()=>{
  let cancelled=false;
  if(accountRole!=='owner'||!accountId)return;
  void createClient().from('first_text_reports').select('*').eq('account_id',accountId).order('period_start',{ascending:false}).limit(24).then(({data,error})=>{if(cancelled)return;setRows(data??[]);setError(error?'No se pudieron cargar las estadísticas.':'');setLoading(false);});
  return()=>{cancelled=true;};
 },[accountRole,accountId]);
 if(accountRole!=='owner')return <p>Esta estadística es exclusiva del CEO.</p>;
 function exportCsv(report:Report){
  const quote=quoteReportCell;
  const content='\uFEFF'+['DIRECCIÓN;TEXTO;CANTIDAD',...report[mode].map(r=>[r.direction,r.phrase??r.word,r.quantity].map(quote).join(';'))].join('\r\n');
  const link=document.createElement('a'),url=URL.createObjectURL(new Blob([content],{type:'text/csv;charset=utf-8'}));link.href=url;link.download=`primeros-textos-${report.period_kind}-${report.period_start.slice(0,10)}.csv`;link.click();URL.revokeObjectURL(url);
 }
 return <div className="space-y-5"><h1 className="text-2xl font-bold">ESTADÍSTICAS · PRIMEROS TEXTOS</h1><p className="text-sm text-muted-foreground">Solo CEO. Una primera frase recibida y una enviada por conversación; se ignoran imágenes, audios y mensajes fallidos. Las frases se agrupan sin distinguir mayúsculas ni espacios repetidos. Informe semanal: sábados a las 7:00 a. m. (Lima). Cada informe mensual acumula lo observado hasta su fecha de corte.</p>
 <div className="flex flex-wrap gap-2"><Button variant={mode==='phrases'?'default':'outline'} onClick={()=>setMode('phrases')}>FRASES COMPLETAS</Button><Button variant={mode==='words'?'default':'outline'} onClick={()=>setMode('words')}>PRIMERA PALABRA</Button><Input className="max-w-sm" placeholder="Buscar frase o palabra…" value={filter} onChange={e=>setFilter(e.target.value)}/></div>
 {loading?<p>Cargando…</p>:error?<p className="text-destructive">{error}</p>:!rows.length?<p>El primer informe se generará el próximo sábado a las 7:00 a. m.</p>:rows.map(report=><section key={report.period_kind+report.period_start} className="rounded-xl border p-4 space-y-3"><div className="flex justify-between flex-wrap gap-2"><div><h2 className="font-semibold">{report.period_kind==='week'?'SEMANA COMPLETA':'ACUMULADO MENSUAL'}</h2><p className="text-xs text-muted-foreground">{new Date(report.period_start).toLocaleString('es-PE',{timeZone:'America/Lima'})} a {new Date(report.period_end).toLocaleString('es-PE',{timeZone:'America/Lima'})}</p></div><Button size="sm" variant="outline" onClick={()=>exportCsv(report)}>DESCARGAR CSV</Button></div><div className="max-h-[28rem] overflow-auto"><table className="w-full text-sm"><thead className="sticky top-0 bg-card"><tr><th className="text-left p-2">Dirección</th><th className="text-left p-2">{mode==='phrases'?'Primera frase':'Primera palabra'}</th><th className="text-right p-2">Cantidad</th></tr></thead><tbody>{report[mode].filter(r=>(r.phrase??r.word??'').includes(filter.toLowerCase())).map((row,i)=><tr key={i} className="border-t"><td className="p-2 align-top">{row.direction==='ENTRANTE'?'Estudiante':'Institución / asesora'}</td><td className="p-2 whitespace-pre-wrap break-words">{row.phrase??row.word}</td><td className="p-2 text-right align-top">{row.quantity}</td></tr>)}</tbody></table>{!report[mode].length&&<p>No hubo primeras frases en este periodo.</p>}</div></section>)}
 {accountId&&<CaseReports accountId={accountId}/>}
 </div>;
}
