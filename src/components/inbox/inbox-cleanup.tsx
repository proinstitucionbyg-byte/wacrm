'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useCan } from '@/hooks/use-can';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';

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
  return <>{(canClear || canHide) && <DropdownMenu><DropdownMenuTrigger className="rounded-xl border border-border px-3 py-2 text-sm" disabled={busy}>MÁS</DropdownMenuTrigger><DropdownMenuContent align="end">{canClear && <DropdownMenuItem className="text-destructive" onClick={()=>setOpen(true)}>Eliminar chat del Inbox</DropdownMenuItem>}{canHide && <DropdownMenuItem onClick={()=>void restoreHidden()}>Mostrar mis mensajes ocultos</DropdownMenuItem>}</DropdownMenuContent></DropdownMenu>}
   <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>¿Eliminar este chat del Inbox?</DialogTitle><DialogDescription>Se retirará el historial actual del Inbox del equipo. Los nuevos mensajes aparecerán como una conversación nueva. Puedes recuperar el historial en RECUPERAR CHATS. No se eliminan vouchers, matrículas ni archivos de Drive. Tampoco se borra el chat del teléfono del estudiante.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" disabled={busy} onClick={()=>setOpen(false)}>CANCELAR</Button><Button variant="destructive" disabled={busy} onClick={()=>void clear()}>{busy?'ELIMINANDO…':'ELIMINAR DEL INBOX'}</Button></DialogFooter></DialogContent></Dialog>
  </>;
}
