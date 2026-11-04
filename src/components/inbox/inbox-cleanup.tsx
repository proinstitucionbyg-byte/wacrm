'use client';
import { useState } from 'react';
import {Trash2} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useCan } from '@/hooks/use-can';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';

export function InboxBulkCleanup({ ids, onCleared }: { ids: string[]; onCleared: (ids: string[]) => void }) {
  const allowed = useCan('inbox_management.conversations');
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  if (!allowed || !ids.length) return null;
  async function clearSelected() {
    setBusy(true);
    try {
      const response = await fetch('/api/inbox/conversations/clear', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversations: ids, confirmed: true }),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || 'No se pudo eliminar la selección.');
      onCleared(result.cleared);
      if (result.failed.length) toast.error(`${result.cleared.length} eliminadas; ${result.failed.length} siguen seleccionadas para revisar.`);
      else { toast.success(`${result.cleared.length} conversaciones retiradas del Inbox del equipo.`); setOpen(false); }
    } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo eliminar la selección.'); }
    finally { setBusy(false); }
  }
  return <><Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-red-500 hover:bg-red-500/10 hover:text-red-400" title={`Eliminar ${ids.length} conversaciones seleccionadas del equipo`} aria-label={`Eliminar ${ids.length} conversaciones seleccionadas del equipo`} disabled={busy || ids.length > 100} onClick={() => setOpen(true)}><Trash2 className="h-4 w-4"/></Button>
    <Dialog open={open} onOpenChange={(value) => { if (!busy) setOpen(value); }}><DialogContent><DialogHeader><DialogTitle>¿Retirar {ids.length} conversaciones del equipo?</DialogTitle><DialogDescription>Las asesoras dejarán de ver sus historiales actuales en el Inbox. Puedes recuperarlos en RECUPERAR CHATS. Los mensajes nuevos volverán a aparecer. Los teléfonos de los estudiantes y sus documentos no se borran.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>Cancelar</Button><Button variant="destructive" disabled={busy} onClick={() => void clearSelected()}>{busy ? 'Eliminando…' : 'Eliminar del equipo'}</Button></DialogFooter></DialogContent></Dialog></>;
}

export function InboxCleanup({ conversationId, onCleared, onRefresh }: {conversationId:string;onCleared:()=>void;onRefresh?:()=>void}) {
  const canClear=useCan('inbox_management.conversations'),canHide=useCan('inbox_management.messages');
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false);
  async function clear() {
    setBusy(true);
    const {error}=await createClient().rpc('set_inbox_cleared',{p_conversation:conversationId,p_clear:true});
    setBusy(false);
    if(error) {toast.error('No se pudo eliminar el chat. Comprueba tu permiso.');return;}
    setOpen(false);toast.success('Chat eliminado del Inbox. Puedes recuperarlo.');onCleared();onRefresh?.();
  }
  async function restoreHidden() {
    setBusy(true);
    // RLS restricts the deletion to this user's own hide markers.
    const {error}=await createClient().rpc('restore_hidden_inbox_messages',{p_conversation:conversationId});
    setBusy(false);
    if(error) toast.error('No se pudieron recuperar los mensajes ocultos.');else {toast.success('Mensajes visibles nuevamente para ti.');onRefresh?.();}
  }
  return <>{(canClear||canHide)&&<DropdownMenu><DropdownMenuTrigger className="h-10 shrink-0 whitespace-nowrap rounded-xl border border-border px-3 text-sm" disabled={busy}>Gestionar chat</DropdownMenuTrigger><DropdownMenuContent align="end">{canClear&&<DropdownMenuItem className="text-destructive" onClick={()=>setOpen(true)}>Eliminar conversación del equipo</DropdownMenuItem>}{canHide&&<DropdownMenuItem onClick={()=>void restoreHidden()}>Mostrar mis mensajes ocultos</DropdownMenuItem>}</DropdownMenuContent></DropdownMenu>}
   <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>¿Eliminar la conversación del Inbox de todo el equipo?</DialogTitle><DialogDescription>Las asesoras dejarán de ver el historial actual. Los nuevos mensajes aparecerán como una conversación nueva. Puedes recuperar el historial en RECUPERAR CHATS. No se eliminan vouchers, matrículas ni archivos de Drive. Tampoco se borra el chat del teléfono del estudiante.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" disabled={busy} onClick={()=>setOpen(false)}>CANCELAR</Button><Button variant="destructive" disabled={busy} onClick={()=>void clear()}>{busy?'ELIMINANDO…':'ELIMINAR DEL EQUIPO'}</Button></DialogFooter></DialogContent></Dialog>
  </>;
}
