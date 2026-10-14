'use client';

import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { BellRing, Mic, Square, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { suggestReminder } from '@/lib/reminders/parse';

interface Reminder { id: string; user_id: string; owner_name: string | null; body: string; due_at: string; repeat_days: number | null; conversation_id: string | null; }
interface ButtonPosition { x: number; y: number; }
const POSITION_KEY = 'wacrm-reminders-button-position';

function keepOnScreen(position: ButtonPosition, width: number, height: number): ButtonPosition {
  return {
    x: Math.max(8, Math.min(position.x, window.innerWidth - width - 8)),
    y: Math.max(8, Math.min(position.y, window.innerHeight - height - 8)),
  };
}

export function RemindersPanel({ conversationId }: { conversationId: string | null }) {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Reminder[]>([]);
  const [teamView, setTeamView] = useState(false);
  const [canViewTeam, setCanViewTeam] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [dueLocal, setDueLocal] = useState('');
  const [repeatDays, setRepeatDays] = useState('');
  const [needsInterval, setNeedsInterval] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; x: number; y: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);
  const positionRef = useRef<ButtonPosition | null>(null);
  const [buttonPosition, setButtonPosition] = useState<ButtonPosition | null>(null);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!mounted) return;
    const button = buttonRef.current;
    if (!button) return;
    try {
      const saved = JSON.parse(localStorage.getItem(POSITION_KEY) || 'null') as ButtonPosition | null;
      if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
        const next = keepOnScreen(saved, button.offsetWidth, button.offsetHeight);
        positionRef.current = next;
        setButtonPosition(next);
      }
    } catch { /* A damaged saved position should not hide the button. */ }
    const onResize = () => {
      const current = positionRef.current;
      if (!current || !buttonRef.current) return;
      const next = keepOnScreen(current, buttonRef.current.offsetWidth, buttonRef.current.offsetHeight);
      positionRef.current = next;
      setButtonPosition(next);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [mounted]);

  function startDrag(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    suppressClickRef.current = false;
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: rect.left, y: rect.top, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveDrag(event: PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 5) return;
    drag.moved = true;
    const next = keepOnScreen({ x: drag.x + event.clientX - drag.startX, y: drag.y + event.clientY - drag.startY }, event.currentTarget.offsetWidth, event.currentTarget.offsetHeight);
    positionRef.current = next;
    setButtonPosition(next);
  }

  function endDrag(event: PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    suppressClickRef.current = drag.moved;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (drag.moved && positionRef.current) {
      try { localStorage.setItem(POSITION_KEY, JSON.stringify(positionRef.current)); } catch { /* Dragging still works without local storage. */ }
    }
  }

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(teamView ? '/api/reminders?scope=team' : '/api/reminders');
      if (!response.ok) throw new Error();
      const result = await response.json() as { reminders: Reminder[]; canViewTeam: boolean; currentUserId: string };
      setItems(result.reminders);
      setCanViewTeam(result.canViewTeam);
      setCurrentUserId(result.currentUserId);
    } catch { toast.error('No se pudieron cargar los recordatorios.'); }
  }, [teamView]);
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
          toast.success('Audio transcrito. Fecha y repetición detectadas automáticamente; revisa antes de guardar.');
        } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo transcribir.'); }
        finally { setTranscribing(false); }
      };
      recorder.start(); setRecording(true);
    } catch { toast.error('No se pudo activar el micrófono. Puedes escribir el recordatorio.'); }
  }

  if (!mounted) return null;

  return createPortal(<>
    <button ref={buttonRef} type="button" onClick={event => { if (suppressClickRef.current) { event.preventDefault(); suppressClickRef.current = false; return; } setOpen(true); }}
      onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}
      title="Mis recordatorios · arrastra para mover" aria-label="Abrir mis recordatorios; arrastra para mover"
      style={buttonPosition ? { left: buttonPosition.x, top: buttonPosition.y } : { right: 16, top: '40%' }}
      className="fixed z-40 inline-flex h-11 touch-none cursor-grab items-center gap-2 rounded-xl border border-sky-500/50 bg-slate-900 px-4 text-slate-100 shadow-xl hover:border-sky-400 hover:bg-slate-800 active:cursor-grabbing">
      <BellRing className="h-4 w-4"/><span className="hidden xl:inline">Recordatorios</span>
    </button>
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader className="border-b border-border">
          <SheetTitle>Mis recordatorios</SheetTitle>
          <SheetDescription>Solo tú ves estos avisos. Llegan a la campana de notificaciones, incluso si cierras el navegador.</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 p-4">
          {canViewTeam && <div className="flex gap-2" aria-label="Vista de recordatorios">
            <button type="button" onClick={() => setTeamView(false)} aria-pressed={!teamView}
              className={`rounded-md border px-3 py-1 text-sm ${!teamView ? 'border-sky-500 text-sky-400' : 'border-border'}`}>Mis recordatorios</button>
            <button type="button" onClick={() => setTeamView(true)} aria-pressed={teamView}
              className={`rounded-md border px-3 py-1 text-sm ${teamView ? 'border-sky-500 text-sky-400' : 'border-border'}`}>Todo el equipo</button>
          </div>}
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
          <p className="text-xs text-muted-foreground">Di qué recordar, cuándo y cada cuánto. La fecha y la repetición se completan solas; solo corrígelas si hace falta.</p>
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
              <div className="min-w-0 flex-1">{teamView && <p className="text-xs font-medium text-sky-400">{item.owner_name || 'Asesora'}</p>}
                <p className="break-words text-sm">{item.body}</p>
                <p className="text-xs text-muted-foreground">{new Date(item.due_at).toLocaleString('es-PE')}{item.repeat_days ? ` · Cada ${item.repeat_days} día(s)` : ''}</p>
              </div>
              {item.user_id === currentUserId && <button type="button" onClick={() => void remove(item.id)} title="Eliminar recordatorio" aria-label="Eliminar recordatorio" className="text-muted-foreground hover:text-red-400"><Trash2 className="h-4 w-4"/></button>}
            </div>)}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  </>, document.body);
}
