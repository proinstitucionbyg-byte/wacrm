'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';

interface MemberTime { user_id: string; display_name: string; area: string; online_seconds: number; away_seconds: number }
interface TaskEvent { id: string; actor_id: string; completed: boolean; created_at: string; title: string }
export function durationLabel(seconds: number) {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

export function TeamOperationReport() {
  const { accountId, canManageMembers } = useAuth();
  const [days, setDays] = useState(7);
  const [members, setMembers] = useState<MemberTime[]>([]);
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    if (!accountId || !canManageMembers) return;
    setLoading(true);
    setError('');
    const until = new Date();
    const from = new Date(until.getTime() - days * 86400000).toISOString();
    const db = createClient();
    const [time, tasks] = await Promise.all([
      db.rpc('member_presence_summary', { p_from: from, p_until: until.toISOString() }),
      db.rpc('system_task_admin_report', { p_from: from, p_until: until.toISOString() }),
    ]);
    if (time.error || tasks.error) setError('No se pudo cargar el control del equipo. Vuelve a actualizar.');
    else {
      setMembers((time.data ?? []) as MemberTime[]);
      setEvents((tasks.data ?? []) as unknown as TaskEvent[]);
    }
    setLoading(false);
  }, [accountId, canManageMembers, days]);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);
  if (!canManageMembers) return null;
  return <section className="space-y-4 rounded-xl border bg-card p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="font-semibold">CONTROL DEL EQUIPO</h2>
      <div className="flex items-center gap-2">
        <select aria-label="Periodo del control del equipo" value={days} onChange={e => setDays(Number(e.target.value))} className="rounded-md border bg-background p-2 text-sm"><option value={7}>ULTIMOS 7 DIAS</option><option value={30}>ULTIMOS 30 DIAS</option></select>
        <Button variant="outline" onClick={() => void load()} disabled={loading}>{loading ? 'CARGANDO...' : 'ACTUALIZAR'}</Button>
      </div>
    </div>
    <p className="text-sm text-muted-foreground">Tiempo observado desde la instalacion de este control. ACTIVO: CRM visible y actividad reciente. EN PAUSA: CRM abierto sin actividad o en segundo plano. Los cortes sin conexion no se suman. Estos tiempos no certifican llamadas ni trabajo realizado.</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="p-2">PERSONA</th><th className="p-2">AREA</th><th className="p-2">ACTIVO</th><th className="p-2">EN PAUSA</th></tr></thead><tbody>{members.map(m => <tr key={m.user_id} className="border-b"><td className="p-2">{m.display_name}</td><td className="p-2">{m.area || 'SIN AREA'}</td><td className="p-2 text-emerald-500">{durationLabel(m.online_seconds)}</td><td className="p-2 text-amber-500">{durationLabel(m.away_seconds)}</td></tr>)}</tbody></table></div>
    <h3 className="font-medium">CUMPLIMIENTO DE AVISOS DEL SISTEMA</h3>
    <p className="text-xs text-muted-foreground">Ultimos 100 cambios del periodo. Leer un aviso no lo marca como realizado; cada marca o desmarca conserva responsable y hora.</p>
    {events.length === 0 ? <p className="text-sm text-muted-foreground">Todavia no hay cambios de cumplimiento registrados en este periodo.</p> : <div className="max-h-80 overflow-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="p-2">FECHA Y HORA</th><th className="p-2">AVISO</th><th className="p-2">RESPONSABLE</th><th className="p-2">ACCION</th></tr></thead><tbody>{events.map(e => <tr key={e.id} className="border-b"><td className="p-2 whitespace-nowrap">{new Date(e.created_at).toLocaleString('es-PE',{timeZone:'America/Lima'})}</td><td className="p-2">{e.title}</td><td className="p-2">{members.find(m => m.user_id === e.actor_id)?.display_name ?? 'MIEMBRO'}</td><td className="p-2">{e.completed ? 'REALIZADO' : 'REABIERTO'}</td></tr>)}</tbody></table></div>}
  </section>;
}
