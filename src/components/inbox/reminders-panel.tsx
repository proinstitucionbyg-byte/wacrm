'use client';

import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { BellRing, Mic, Square, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { parseReminderDrafts, type ReminderDraft } from '@/lib/reminders/instructions';

interface Reminder { id: string; user_id: string; owner_name: string | null; body: string; due_at: string; repeat_days: number | null; conversation_id: string | null; action_kind: string; destination_phone: string | null; message_text: string | null; }
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
  const [recipients,setRecipients]=useState<{user_id:string;full_name:string|null;nickname:string|null;area:string|null}[]>([]);
  const [selectedRecipients,setSelectedRecipients]=useState<string[]>([]);
  const [body, setBody] = useState('');
  const [drafts, setDrafts] = useState<ReminderDraft[]>([]);
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
      const result = await response.json() as { reminders: Reminder[]; canViewTeam: boolean; currentUserId: string;recipients:typeof recipients };
      setItems(result.reminders);
      setCanViewTeam(result.canViewTeam);
      setCurrentUserId(result.currentUserId);
      setRecipients(result.recipients??[]);
    } catch { toast.error('No se pudieron cargar los recordatorios.'); }
  }, [teamView]);
  useEffect(() => { if (open) void refresh(); }, [open, refresh]);
  useEffect(() => () => { recorderRef.current?.stop(); streamRef.current?.getTracks().forEach(track => track.stop()); }, []);

  function updateBody(value: string) {
    setBody(value);
    const parsed = parseReminderDrafts(value);
    setDrafts(parsed);
    const first = parsed[0];
    setDueLocal(first?.dueLocal || '');
    setRepeatDays(first?.repeatDays ? String(first.repeatDays) : '');
    setNeedsInterval(first?.needsInterval || false);
  }

  function updateDraft(index: number, change: Partial<ReminderDraft>) {
    setDrafts(current => current.map((item, at) => at === index ? { ...item, ...change } : item));
  }

  async function save() {
    const entries = drafts.map((draft, index) => ({ ...draft,
      dueLocal: drafts.length === 1 ? dueLocal : draft.dueLocal,
      repeatDays: drafts.length === 1 ? Number(repeatDays) || null : draft.repeatDays,
      needsInterval: drafts.length === 1 ? needsInterval : draft.needsInterval,
      label: `RE${index + 1}` }));
    if (!entries.length || entries.some(entry => !entry.body || !entry.dueLocal || entry.needsInterval && !entry.repeatDays)) {
      toast.error('Revisa la fecha y repetición de cada recordatorio.'); return;
    }
    if (entries.some(entry => !Number.isFinite(new Date(entry.dueLocal).getTime()) || new Date(entry.dueLocal).getTime() <= Date.now())) {
      toast.error('Cada fecha y hora debe ser futura.'); return;
    }
    if (entries.some(entry => entry.sendIntent && (!entry.destinationPhone || !entry.messageText))) {
      toast.error('Para cada mensaje revisa el celular y el texto exacto que se enviará.'); return;
    }
    if (entries.some(entry => entry.sendIntent && entry.repeatDays)) {
      toast.error('Un mensaje programado se envía una sola vez.'); return;
    }
    setSaveBusy(true);
    try {
      const response = await fetch('/api/reminders', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reminders: entries.map(entry => ({ body: entry.body,
          due_at: new Date(entry.dueLocal).toISOString(), repeat_days: entry.repeatDays,
          conversation_id: conversationId, action_kind: entry.sendIntent ? 'message' : 'notification',
          destination_phone: entry.destinationPhone, message_text: entry.messageText,recipient_ids:selectedRecipients.length?selectedRecipients:undefined })) }) });
      if (!response.ok) throw new Error((await response.json()).error || 'No se pudo guardar.');
      setBody(''); setDrafts([]); setDueLocal(''); setRepeatDays(''); setNeedsInterval(false);
      await refresh();
      toast.success(`${entries.length} recordatorio(s) guardado(s). Los mensajes se enviarán solo si sigue abierta la ventana de WhatsApp.`);
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
      className="fixed z-40 inline-flex h-11 touch-none cursor-grab items-center gap-2 rounded-xl border border-sky-500/50 bg-slate-900 px-4 text-slate-100 shadow-xl hover:border-sky-400 hover:bg-slate-800 active:cursor-grabbing light:border-border light:bg-card light:text-sky-800 light:shadow-lg light:hover:bg-secondary">
      <BellRing className="h-4 w-4"/><span className="hidden xl:inline">Recordatorios</span>
    </button>
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader className="border-b border-border">
          <SheetTitle>Mis recordatorios</SheetTitle>
          <SheetDescription>{canViewTeam
            ? 'Cada asesora ve y gestiona solo sus recordatorios. Como CEO, también puedes consultar los del equipo.'
            : 'Tus recordatorios son personales y llegan a la campana de notificaciones, incluso si cierras el navegador.'}</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 p-4">
          {canViewTeam && <div className="flex gap-2" aria-label="Vista de recordatorios">
            <button type="button" onClick={() => setTeamView(false)} aria-pressed={!teamView}
              className={`rounded-md border px-3 py-1 text-sm ${!teamView ? 'border-sky-500 text-sky-400' : 'border-border'}`}>Mis recordatorios</button>
            <button type="button" onClick={() => setTeamView(true)} aria-pressed={teamView}
              className={`rounded-md border px-3 py-1 text-sm ${teamView ? 'border-sky-500 text-sky-400' : 'border-border'}`}>Todo el equipo</button>
          </div>}
          <label className="block text-sm">¿Para quien es el recordatorio?<select multiple value={selectedRecipients} onChange={event=>setSelectedRecipients(Array.from(event.target.selectedOptions,option=>option.value))} className="mt-1 max-h-32 w-full rounded-md border border-border bg-background p-2">{recipients.map(person=><option key={person.user_id} value={person.user_id}>{person.nickname||person.full_name||'Integrante'}{person.user_id===currentUserId?' (yo)':''}{person.area?' — '+person.area:''}</option>)}</select><span className="text-xs text-muted-foreground">Sin seleccionar personas: solo para mi. Puedes elegir varios integrantes.</span></label>
          <label className="block text-sm">¿Qué quieres recordar?
            <textarea value={body} onChange={event => updateBody(event.target.value)} rows={3} maxLength={10000}
              placeholder="Recuérdame mañana a las 3 de la tarde llamar al estudiante"
              className="mt-1 w-full rounded-md border border-border bg-background p-2" />
          </label>
          <button type="button" onClick={() => void toggleRecording()} disabled={transcribing}
            className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50">
            {recording ? <Square className="h-4 w-4 text-red-500"/> : <Mic className="h-4 w-4"/>}
            {transcribing ? 'Transcribiendo...' : recording ? 'Detener audio' : 'Dictar por audio'}
          </button>
          <p className="text-xs text-muted-foreground">Puedes dictar o escribir RE1, RE2… o “recordatorio 1, recordatorio 2…” en un solo audio. Revisa cada fecha. Para enviar un mensaje, indica el celular y el texto exacto; se enviará solo si la persona escribió durante las últimas 24 horas.</p>
          {drafts.length <= 1 && <><label className="block text-sm">Fecha y hora
            <input type="datetime-local" step="1" value={dueLocal} onChange={event => setDueLocal(event.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-background p-2" />
          </label>
          <label className="block text-sm">Repetir cada cuántos días (opcional)
            <input type="number" min={1} max={365} value={repeatDays} onChange={event => {setRepeatDays(event.target.value); setNeedsInterval(false);}}
              placeholder="Sin repetición" className="mt-1 w-full rounded-md border border-border bg-background p-2" />
          </label>
          {needsInterval && <p className="text-xs text-amber-400">Indica un número de días para repetirlo.</p>}</>}
          {drafts.map((draft, index) => <div key={index} className="space-y-2 rounded-md border border-border p-3 text-sm">
            <p className="font-medium">{draft.label}: {draft.body}</p>
            {drafts.length > 1 && <><label className="block">Fecha y hora
              <input type="datetime-local" step="1" value={draft.dueLocal} onChange={event => updateDraft(index, { dueLocal: event.target.value })}
                className="mt-1 w-full rounded-md border border-border bg-background p-2" /></label>
              <label className="block">Repetir cada cuántos días (opcional)
                <input type="number" min={1} max={365} value={draft.repeatDays ?? ''} onChange={event => updateDraft(index, { repeatDays: Number(event.target.value) || null, needsInterval: false })}
                  className="mt-1 w-full rounded-md border border-border bg-background p-2" /></label></>}
            {draft.sendIntent && <><p className="font-medium text-sky-400">Mensaje programado de WhatsApp</p>
              <label className="block">Celular de destino
                <input value={draft.destinationPhone || ''} onChange={event => updateDraft(index, { destinationPhone: event.target.value })}
                  className="mt-1 w-full rounded-md border border-border bg-background p-2" /></label>
              <label className="block">Texto exacto que se enviará
                <textarea value={draft.messageText || ''} onChange={event => updateDraft(index, { messageText: event.target.value })} rows={2}
                  className="mt-1 w-full rounded-md border border-border bg-background p-2" /></label></>}
          </div>)}
          <button type="button" onClick={() => void save()} disabled={saveBusy || transcribing || recording}
            className="w-full rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground disabled:opacity-50">
            {saveBusy ? 'Guardando...' : 'Guardar recordatorio'}
          </button>
          <div className="border-t border-border pt-4">
            <h3 className="mb-2 font-medium">Próximos</h3>
            {items.length === 0 && <p className="text-sm text-muted-foreground">Todavía no tienes recordatorios.</p>}
            {items.map(item => <div key={item.id} className="mb-2 flex items-start gap-2 rounded-md border border-border p-3">
              <div className="min-w-0 flex-1">{teamView && <p className="text-xs font-medium text-sky-400">{item.owner_name || 'Asesora'}</p>}
                <p className="break-words text-sm">{item.action_kind === 'message' ? `Enviar al ${item.destination_phone}: ${item.message_text}` : item.body}</p>
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
