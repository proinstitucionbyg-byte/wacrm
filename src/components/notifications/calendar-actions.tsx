'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Notification } from '@/types';
import { Button } from '@/components/ui/button';
const actions = [['groups','AVISADO A LOS GRUPOS'],['teacher','AVISADO AL DOCENTE'],['students','AVISADO A LOS ESTUDIANTES AFECTADOS'],['new_students','AVISADO A LOS NUEVOS INGRESOS'],['coordinator','AVISADO A LA COORDINADORA DE FIDELIZACIÓN']] as const;
export function CalendarActions({notice,onChanged}:{notice:Notification;onChanged:()=>Promise<void>}) {
  const [busy,setBusy]=useState(''),[error,setError]=useState('');
  const allChecked = actions.every(([key]) => key === 'coordinator' && !notice.body?.includes('COORDINADORA')
    ? true : notice.action_checks?.[key]?.completed === true);
  async function mark(action:string,completed:boolean){
    setBusy(action);setError('');
    try { const {error}=await createClient().rpc('complete_calendar_action',{p_notification:notice.id,p_action:action,p_completed:completed});if(error)throw error;await onChanged(); }
    catch {setError('No se pudo guardar. Reintenta.');} finally {setBusy('');}
  }
  async function complete() {
    setBusy('complete'); setError('');
    try {
      const { error: rpcError } = await createClient().rpc('complete_system_task', {
        p_notification: notice.id,
        p_completed: !notice.completed_at,
      });
      if (rpcError) throw rpcError;
      await onChanged();
    } catch { setError('No se pudo cambiar el estado. Verifica todos los avisos y reintenta.'); }
    finally { setBusy(''); }
  }
  return <div className="grid gap-3 border-t border-red-500/30 p-4 text-xs sm:grid-cols-2">
    {actions.map(([key,label])=>{const item=notice.action_checks?.[key];return <label key={key} className="flex items-start gap-2"><input type="checkbox" disabled={!!busy} checked={item?.completed??false} onChange={e=>void mark(key,e.target.checked)}/><span>{label}{item?.completed&&<small className="text-muted-foreground block">{new Date(item.at).toLocaleString('es-PE',{timeZone:'America/Lima'})}</small>}</span></label>;})}
    {error&&<p role="alert" className="text-red-500">{error}</p>}
    <div className="sm:col-span-2">
      <Button type="button" size="sm" disabled={!!busy || (!allChecked && !notice.completed_at)} onClick={() => void complete()}>
        {notice.completed_at ? '✓ REALIZADO · DESMARCAR' : 'MARCAR COMO REALIZADO'}
      </Button>
      {!allChecked && !notice.completed_at && <span className="ml-2 text-muted-foreground">Completa todos los avisos para habilitarlo.</span>}
    </div>
    <p className="text-muted-foreground sm:col-span-2">LOS PDF YA ENTREGADOS SE CONSERVAN. CADA CHECK GUARDA RESPONSABLE Y HORA.</p>
  </div>;
}
