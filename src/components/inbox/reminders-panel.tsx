'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { BellRing, Mic, Square, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { suggestReminder } from '@/lib/reminders/parse';

interface Reminder { id: string; body: string; due_at: string; repeat_days: number | null; conversation_id: string | null; }

export function RemindersPanel({ conversationId }: { conversationId: string | null }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Reminder[]>([]);
  const [body, setBody] = useState('');
  const [dueLocal, setDueLocal] = useState('');
  const [repeatDays, setRepeatDays] = useState('');
  const [needsInterval, setNeedsInterval] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/reminders');
      if (!response.ok) throw new Error();
      const result = await response.json() as { reminders: Reminder[] };
      setItems(result.reminders);
    } catch { toast.error('No se pudieron cargar los recordatorios.'); }
  }, []);
  useEffect(() => { if (open) void refresh(); }, [open, refresh]);
  useEffect(() => () => { recorderRef.current?.stop(); streamRef.current?.getTracks().forEach(track => track.stop()); }, []);

  function updateBody(value: string) {
    setBody(value);
    if (!value.trim()) return;
    const suggested = suggestReminder(value);
    setDueLocal(suggested.dueLocal);
    setRepeatDays(suggested.repeatDays ? String(suggested.repeatDays) : '');
    setNeedsInterval(suggested.needsInterval);
  }

  async function save() {
    if (!body.trim() || !dueLocal || needsInterval && !repeatDays) {
      toast.error('Escribe el recordatorio, confirma la fecha y especifica cada cuántos días se repetirá.');
      return;
    }
    const due = new Date(dueLocal);
    if (!Number.isFinite(due.getTime()) || due.getTime() <= Date.now()) {
      toast.error('Elige una fecha y hora futuras.'); return;
    }
    setSaveBusy(true);
    try {
      const response = await fetch('/api/reminders', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: body.trim(), due_at: due.toISOString(), repeat_days: repeatDays ? Number(repeatDays) : null,
          conversation_id: conversationId }) });
      if (!response.ok) throw new Error((await response.json()).error || 'No se pudo guardar.');
      setBody(''); setDueLocal(''); setRepeatDays(''); setNeedsInterval(false);
      await refresh();
      toast.success('Recordatorio guardado. Recibirás una notificación a la hora indicada.');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo guardar.'); }
    finally { setSaveBusy(false); }
  }

  async function remove(id: string) {
    try {
      const response = await fetch(`/api/reminders/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error();
      setItems(current => current.filter(item => item.id !== id));
      toast.success('Recordatorio eliminado.');
    } catch { toast.error('No se pudo eliminar.'); }
  }

  async function toggleRecording() {
    if (recorderRef.current?.state === 'recording') { recorderRef.current.stop(); setRecording(false); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      streamRef.current = stream;
      recorderRef.current = recorder;
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach(track => track.stop());
        recorderRef.current = null;
        setRecording(false);
        const audio = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        if (!audio.size) return;
        setTranscribing(true);
        try {
          const extension = recorder.mimeType.includes('mp4') ? 'mp4' : recorder.mimeType.includes('ogg') ? 'ogg' : 'webm';
          const form = new FormData(); form.append('audio', audio, `recordatorio.${extension}`);
          const response = await fetch('/api/reminders/transcribe', { method: 'POST', body: form });
          const result = await response.json() as { text?: string; error?: string };
          if (!response.ok || !result.text) throw new Error(result.error || 'No se pudo entender el audio.');
          updateBody(result.text);
          toast.success('Audio transcrito. Confirma la fecha antes de guardarlo.');
        } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo transcribir.'); }
        finally { setTranscribing(false); }
      };
      recorder.start(); setRecording(true);
    } catch { toast.error('No se pudo activar el micrófono. Puedes escribir el recordatorio.'); }
  }

  return <>
    <button type="button" onClick={() => setOpen(true)} title="Mis recordatorios" aria-label="Abrir mis recordatorios"
      className="fixed bottom-5 right-5 z-40 inline-flex h-11 items-center gap-2 rounded-xl border border-sky-500/50 bg-slate-900 px-4 text-slate-100 shadow-xl hover:border-sky-400 hover:bg-slate-800">
      <BellRing className="h-4 w-4"/><span className="hidden xl:inline">Recordatorios</span>
    </button>
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader className="border-b border-border">
          <SheetTitle>Mis recordatorios</SheetTitle>
          <SheetDescription>Solo tú ves estos avisos. Llegan a la campana de notificaciones, incluso si cierras el navegador.</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 p-4">
          <label className="block text-sm">¿Qué quieres recordar?
            <textarea value={body} onChange={event => updateBody(event.target.value)} rows={3} maxLength={1000}
              placeholder="Recuérdame mañana a las 3 de la tarde llamar al estudiante"
              className="mt-1 w-full rounded-md border border-border bg-background p-2" />
          </label>
          <button type="button" onClick={() => void toggleRecording()} disabled={transcribing}
            className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50">
            {recording ? <Square className="h-4 w-4 text-red-500"/> : <Mic className="h-4 w-4"/>}
            {transcribing ? 'Transcribiendo...' : recording ? 'Detener audio' : 'Dictar por audio'}
          </button>
          <p className="text-xs text-muted-foreground">Revisa el texto y la fecha sugerida. Si dices «mañana» sin hora, se propone 9:00 a. m.</p>
          <label className="block text-sm">Fecha y hora
            <input type="datetime-local" value={dueLocal} onChange={event => setDueLocal(event.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-background p-2" />
          </label>
          <label className="block text-sm">Repetir cada cuántos días (opcional)
            <input type="number" min={1} max={365} value={repeatDays} onChange={event => {setRepeatDays(event.target.value); setNeedsInterval(false);}}
              placeholder="Sin repetición" className="mt-1 w-full rounded-md border border-border bg-background p-2" />
          </label>
          {needsInterval && <p className="text-xs text-amber-400">Indica un número de días para repetirlo.</p>}
          <button type="button" onClick={() => void save()} disabled={saveBusy || transcribing || recording}
            className="w-full rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground disabled:opacity-50">
            {saveBusy ? 'Guardando...' : 'Guardar recordatorio'}
          </button>
          <div className="border-t border-border pt-4">
            <h3 className="mb-2 font-medium">Próximos</h3>
            {items.length === 0 && <p className="text-sm text-muted-foreground">Todavía no tienes recordatorios.</p>}
            {items.map(item => <div key={item.id} className="mb-2 flex items-start gap-2 rounded-md border border-border p-3">
              <div className="min-w-0 flex-1"><p className="break-words text-sm">{item.body}</p>
                <p className="text-xs text-muted-foreground">{new Date(item.due_at).toLocaleString('es-PE')}{item.repeat_days ? ` · Cada ${item.repeat_days} día(s)` : ''}</p>
              </div>
              <button type="button" onClick={() => void remove(item.id)} title="Eliminar recordatorio" aria-label="Eliminar recordatorio" className="text-muted-foreground hover:text-red-400"><Trash2 className="h-4 w-4"/></button>
            </div>)}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  </>;
}
