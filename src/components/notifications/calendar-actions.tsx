'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Notification } from '@/types';
const actions = [['groups','AVISADO A LOS GRUPOS'],['teacher','AVISADO AL DOCENTE'],['students','AVISADO A LOS ESTUDIANTES'],['new_students','AVISADO A LOS NUEVOS INGRESOS']] as const;
export function CalendarActions({notice,onChanged}:{notice:Notification;onChanged:()=>Promise<void>}) {
  const [busy,setBusy]=useState(''),[error,setError]=useState('');
  async function mark(action:string,completed:boolean){
    setBusy(action);setError('');
    try { const {error}=await createClient().rpc('complete_calendar_action',{p_notification:notice.id,p_action:action,p_completed:completed});if(error)throw error;await onChanged(); }
    catch {setError('No se pudo guardar. Reintenta.');} finally {setBusy('');}
  }
  return <div className="grid gap-3 border-t border-red-500/30 p-4 text-xs sm:grid-cols-2">
    {actions.map(([key,label])=>{const item=notice.action_checks?.[key];return <label key={key} className="flex items-start gap-2"><input type="checkbox" disabled={!!busy} checked={item?.completed??false} onChange={e=>void mark(key,e.target.checked)}/><span>{label}{item?.completed&&<small className="text-muted-foreground block">{new Date(item.at).toLocaleString('es-PE',{timeZone:'America/Lima'})}</small>}</span></label>;})}
    {error&&<p role="alert" className="text-red-500">{error}</p>}
    <p className="text-muted-foreground sm:col-span-2">LOS PDF YA ENTREGADOS SE CONSERVAN. CADA CHECK GUARDA RESPONSABLE Y HORA.</p>
  </div>;
}
