'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useCan } from '@/hooks/use-can';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { toast } from 'sonner';

export function InboxRecovery({ onChanged }: { onChanged: () => void }) {
  const can = useCan('inbox_management.conversations');
  const [open,setOpen] = useState(false),[busy,setBusy] = useState(false);
  const [rows,setRows] = useState<{id:string;name:string;cleared_at:string}[]>([]);
  if (!can) return null;
  async function load() {
    setBusy(true);
    const {data,error}=await createClient().rpc('list_cleared_inbox');
    if(error) toast.error('No se pudieron cargar los chats eliminados.');
    else setRows(data ?? []);
    setBusy(false);
  }
  async function restore(id:string) {
    setBusy(true);
    const {error}=await createClient().rpc('set_inbox_cleared',{p_conversation:id,p_clear:false});
    if(error) toast.error('No tienes permiso para recuperar este chat.');
    else { toast.success('Chat e historial recuperados.'); onChanged(); }
    await load();
  }
  return <><Button size="sm" variant="ghost" onClick={()=>{setOpen(true);void load();}}>RECUPERAR CHATS</Button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="sm:max-w-xl max-h-[80vh] overflow-y-auto"><DialogHeader><DialogTitle>Chats eliminados del Inbox</DialogTitle><DialogDescription>Recuperar vuelve a mostrar el historial. Los pagos y documentos académicos se conservan.</DialogDescription></DialogHeader>
    {busy && <p>Cargando…</p>}{!busy && !rows.length && <p>No hay chats por recuperar.</p>}
    {rows.map(row=><div key={row.id} className="flex items-center justify-between gap-3 rounded border p-3"><div className="min-w-0 break-words"><p>{row.name}</p><p className="text-xs text-muted-foreground">{new Date(row.cleared_at).toLocaleString('es-PE',{timeZone:'America/Lima'})}</p></div><Button size="sm" disabled={busy} onClick={()=>void restore(row.id)}>RECUPERAR</Button></div>)}
    </DialogContent></Dialog></>;
}
