'use client';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { usePresence } from '@/hooks/use-presence';
import { PresenceDot } from '@/components/presence/presence-dot';
import { TEAM_AREAS, type SalesMember } from '@/lib/sales-routing';

type Member = SalesMember & { full_name: string | null; email: string | null; account_role: string };
export function SalesRoutingPanel() {
  const [members,setMembers] = useState<Member[]>([]);
  const [enabled,setEnabled] = useState(false);
  const [version,setVersion] = useState(0);
  const [loading,setLoading] = useState(true);
  const [saving,setSaving] = useState(false);
  const [error,setError] = useState('');
  const {getPresence} = usePresence();
  const total = members.reduce((sum,member)=>sum+member.percentage,0);
  const load = useCallback(async()=>{
    setLoading(true);
    try {
      const res=await fetch('/api/account/sales-routing',{cache:'no-store'});
      const data=await res.json(); if(!res.ok) throw new Error(data.error);
      setMembers(data.members);setEnabled(data.enabled);setVersion(data.version);setError('');
    } catch(err) { setError(err instanceof Error ? err.message : 'No se pudo cargar el reparto'); }
    finally {setLoading(false);}
  },[]);
  useEffect(()=>{void load();},[load]);
  function change(userId:string,patch:Partial<SalesMember>) {setMembers((rows)=>rows.map((row)=>row.user_id===userId?{...row,...patch}:row));}
  async function save() {
    setSaving(true);
    try {
      const res=await fetch('/api/account/sales-routing',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled,version,members:members.map(({user_id,area,cargo,percentage})=>({user_id,area,cargo,percentage}))})});
      const data=await res.json();if(!res.ok) throw new Error(data.error);
      setVersion(data.version);setError('');toast.success('Área, cargo y reparto guardados.');
    } catch(err) {setError(err instanceof Error ? err.message : 'No se pudo guardar');}
    finally {setSaving(false);}
  }
  return <Card><CardContent className="space-y-4 p-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">AREAS, CARGOS Y REPARTO DE VENTAS</h2><p className="mt-1 max-w-2xl text-sm text-muted-foreground">Tú decides la función de cada cuenta y qué porcentaje recibe. El cargo describe su trabajo; los permisos de acceso se configuran en el listado de miembros.</p></div><Button variant="outline" size="sm" disabled={loading||saving} onClick={load}>Actualizar equipo</Button></div>
    {loading ? <p className="text-sm">Cargando equipo…</p> : <>
      <div className="space-y-3">{members.map((member)=><div key={member.user_id} className="grid gap-3 rounded-lg border border-border p-4 lg:grid-cols-[minmax(180px,1fr)_180px_minmax(150px,1fr)_100px] lg:items-end">
        <div className="min-w-0"><div className="flex items-center gap-2"><PresenceDot status={getPresence(member.user_id)}/><span className="truncate text-sm font-medium">{member.full_name||'SIN NOMBRE'}</span></div><p className="mt-1 break-all text-xs text-muted-foreground">{member.email}</p></div>
        <label className="text-xs">AREA<select aria-label={`Área de ${member.full_name}`} className="mt-1 w-full rounded border border-border bg-background p-2 text-sm" disabled={saving} value={member.area} onChange={(e)=>change(member.user_id,{area:e.target.value,...(e.target.value!=='VENTAS'?{percentage:0}:{})})}>{TEAM_AREAS.map((area)=><option key={area}>{area}</option>)}</select></label>
        <label className="text-xs">CARGO<input aria-label={`Cargo de ${member.full_name}`} value={member.cargo} maxLength={80} disabled={saving} onChange={(e)=>change(member.user_id,{cargo:e.target.value})} placeholder="AGENTE, COORDINADOR…" className="mt-1 w-full rounded border border-border bg-background p-2 text-sm"/></label>
        {member.area === 'VENTAS' ? <label className="text-xs">VENTAS %<input aria-label={`Porcentaje de ${member.full_name}`} type="number" min={0} max={100} step={1} disabled={saving||member.account_role==='viewer'} value={member.percentage} onChange={(e)=>change(member.user_id,{percentage:Number(e.target.value)})} className="mt-1 w-full rounded border border-border bg-background p-2 text-sm"/></label> : <p className="text-xs text-muted-foreground">SIN REPARTO POR PORCENTAJE</p>}
      </div>)}</div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/40 p-4"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled} disabled={saving} onChange={(e)=>setEnabled(e.target.checked)}/>Activar reparto automático después de cuatro interacciones</label><span className={total===100?'text-sm font-semibold text-emerald-400':'text-sm font-semibold text-amber-400'}>TOTAL: {total}% / 100%</span></div>
      <p className="text-xs text-muted-foreground">Para activarlo, el total debe ser 100%. Solo reciben chats las cuentas de VENTAS con porcentaje mayor que cero, permiso de chat y conexión activa. Varias imágenes o mensajes automáticos seguidos cuentan como una respuesta. Si nadie está conectado, el chat queda pendiente de asignación.</p>
      <div className="flex flex-wrap items-center gap-3"><Button onClick={save} disabled={saving||!members.length||total>100||(enabled&&total!==100)}>{saving?'Guardando…':'Guardar áreas y reparto'}</Button><span className="text-xs text-muted-foreground">{enabled?'REPARTO ACTIVADO AL GUARDAR':'REPARTO DESACTIVADO AL GUARDAR'}</span></div>
    </>}
    {error&&<p role="alert" className="text-sm text-red-400">{error}</p>}
  </CardContent></Card>;
}
