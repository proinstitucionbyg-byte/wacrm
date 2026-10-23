'use client';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ENROLLMENT_FIELDS, missingRequiredEnrollmentFields, type EnrollmentData } from '@/lib/matriculas/enrollment';
interface IntakeDraft {
  id: string;
  version: number;
  data: EnrollmentData;
  issues: string[];
  can_edit: boolean;
}
interface WelcomeTask {
  id: string;
  stage?: string;
  welcome_due_at: string;
  completed_at: string | null;
  backup_sent_at: string | null;
  status: string;
}
export function EnrollmentWelcomeCheck({
  conversationId,
}: {
  conversationId: string;
}) {
  const [task, setTask] = useState<WelcomeTask | null>(null),
    [intake, setIntake] = useState<IntakeDraft | null>(null),
    [busy, setBusy] = useState(''),
    [error, setError] = useState('');
  const [intakeData, setIntakeData] = useState<EnrollmentData>({});
  const [confirmedFields, setConfirmedFields] = useState<string[]>([]);
  const [feedback, setFeedback] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/enrollments/welcome?conversation=${conversationId}`
      );
      if (!res.ok) throw Error('No se pudo comprobar la bienvenida.');
      const data = await res.json();
      setTask(Array.isArray(data.tasks) ? (data.tasks[0] ?? null) : null);
      setIntake(data.intake ?? null);
      setIntakeData(data.intake?.data ?? {});
      setConfirmedFields([]);
      setNow(Date.now());
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar.');
    }
  }, [conversationId]);
  useEffect(() => {
    setTask(null);
    void Promise.resolve().then(load);
    // Load on chat selection only. Polling this card previously accumulated
    // duplicate DOM slots in the inbox on every refresh.
  }, [load]);
  async function complete(task: WelcomeTask) {
    setBusy(task.id);
    try {
      const res = await fetch('/api/enrollments/welcome', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: task.id }),
      });
      const data = await res.json();
      if (!res.ok) throw Error(data.error);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo marcar.');
    } finally {
      setBusy('');
    }
  }
  async function registerMissingIntake() {
    if (!intake) return;
    const missing = missingRequiredEnrollmentFields(intakeData);
    if (!missing.length || missing.some((key) => !confirmedFields.includes(key) || !intakeData[key]?.trim())) return;
    setBusy('intake');
    setError('');
    setFeedback('');
    try {
      const patch = await fetch(`/api/enrollments/${intake.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: intakeData, version: intake.version }),
      });
      const saved = await patch.json();
      if (!patch.ok) throw Error(saved.error ?? 'No se pudieron guardar los datos.');
      if (saved.issues?.length) {
        setIntake({ ...intake, data: saved.draft.data, version: saved.draft.version, issues: saved.issues });
        setIntakeData(saved.draft.data);
        setError('Datos guardados. Falta una comprobación humana antes de registrar o emitir documentos.');
        return;
      }
      const submit = await fetch(`/api/enrollments/${intake.id}/submit`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: saved.draft.version }),
      });
      const result = await submit.json();
      if (!submit.ok) throw Error(result.error ?? 'No se pudo enviar a registro.');
      setIntake(null);
      await load();
      setFeedback('Datos completos: ficha enviada a la cola de registro. Esto todavía no confirma que los documentos se hayan enviado.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron registrar los datos faltantes.');
    } finally {
      setBusy('');
    }
  }
  return (
    <div className="contents" data-enrollment-welcome-slot>
      {intake && intake.can_edit && missingRequiredEnrollmentFields(intakeData).length > 0 && (
        <section className="mx-2 my-1 rounded-lg border border-amber-500/50 bg-background p-2 text-xs sm:mx-4" aria-label="Registrar datos faltantes de matrícula">
          <strong>DATOS FALTANTES · SOLO PARA COMPLETAR LO QUE YA FALTA</strong>
          <p className="mt-1 text-muted-foreground">Verifica el chat y completa los campos vacíos. Dirección y segundo celular son opcionales. La revisión del documento y del pago sigue siendo humana.</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {missingRequiredEnrollmentFields(intakeData).map((key) => (
              <label key={key} className="min-w-0">
                {ENROLLMENT_FIELDS[key]}
                {key === 'document_type' ? (
                  <select disabled={busy === 'intake'} value={intakeData[key] ?? ''} onChange={(event) => { setIntakeData({ ...intakeData, [key]: event.target.value }); setConfirmedFields((fields) => fields.filter((field) => field !== key)); }} className="mt-1 w-full rounded border border-border bg-background p-2">
                    <option value="">Seleccionar</option>{['DNI','CARNE DE EXTRANJERIA','PASAPORTE','OTRO'].map((type) => <option key={type}>{type}</option>)}
                  </select>
                ) : (
                  <input disabled={busy === 'intake'} type={['birth_date','start_date','payment_date'].includes(key) ? 'date' : key === 'email' ? 'email' : 'text'} value={intakeData[key] ?? ''} onChange={(event) => { setIntakeData({ ...intakeData, [key]: event.target.value }); setConfirmedFields((fields) => fields.filter((field) => field !== key)); }} className="mt-1 w-full rounded border border-border bg-background p-2" />
                )}
                <span className="mt-1 flex items-center gap-2"><input type="checkbox" disabled={busy === 'intake' || !intakeData[key]?.trim()} checked={confirmedFields.includes(key)} onChange={(event) => setConfirmedFields((fields) => event.target.checked ? [...new Set([...fields,key])] : fields.filter((field) => field !== key))} /> Dato verificado en el chat</span>
              </label>
            ))}
          </div>
          <Button size="sm" className="mt-2" disabled={busy === 'intake' || missingRequiredEnrollmentFields(intakeData).some((key) => !confirmedFields.includes(key) || !intakeData[key]?.trim())} onClick={() => void registerMissingIntake()}>{busy === 'intake' ? 'GUARDANDO…' : 'REGISTRAR DATOS FALTANTES'}</Button>
        </section>
      )}
      {intake?.issues.length ? (
        <ul className="mx-2 my-1 list-disc rounded border border-amber-500/30 p-2 pl-6 text-xs text-amber-700 sm:mx-4">
          {intake.issues.map((issue) => <li key={issue}>{issue}</li>)}
        </ul>
      ) : null}
      {task && (
        <div
          data-enrollment-welcome-id={task.id}
          className="mx-2 my-1 rounded-lg border border-sky-500/40 bg-sky-500/10 p-2 text-xs leading-tight sm:mx-4 sm:my-2 sm:p-3 sm:text-sm"
        >
          {task.stage === 'provisional' && (
            <div className="mb-3 rounded-lg border border-amber-500 bg-amber-500/15 p-3">
              <strong>
                PAGO VALIDADO · DATOS PENDIENTES · DOCUMENTOS NO EMITIDOS
              </strong>
              <p>
                FIDELIZACIÓN: completar los datos escritos, conservar su
                pantallazo y gestionar el enlace verificado si empieza clases.
                La bienvenida tiene su plazo de dos horas; marcarla no cierra
                los datos pendientes.
              </p>
            </div>
          )}
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={!!task.completed_at}
              disabled={
                !!busy ||
                !!task.completed_at ||
                now >= Date.parse(task.welcome_due_at) ||
                task.status !== 'started'
              }
              onChange={() => void complete(task)}
            />
            <span className="min-w-0">
              <strong>BIENVENIDA GESTIONADA</strong>
              <br className="sm:hidden" />
              <span className="hidden sm:inline"> · </span>
              <span className="sm:hidden">{task.completed_at
                ? 'RESPALDO CANCELADO.'
                : task.backup_sent_at
                  ? 'BIENVENIDA AUTOMÁTICA ENVIADA.'
                  : `Vence: ${new Date(task.welcome_due_at).toLocaleTimeString('es-PE', { timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit' })}. Marca para cancelar el respaldo.`}</span>
              <span className="hidden sm:inline">{task.completed_at
                ? 'MARCADA: SE CANCELO LA BIENVENIDA AUTOMATICA DE RESPALDO.'
                : task.backup_sent_at
                  ? 'BIENVENIDA AUTOMATICA ENVIADA.'
                  : `Plazo: ${new Date(task.welcome_due_at).toLocaleString('es-PE', { timeZone: 'America/Lima' })}. Marcar basta para cancelar el respaldo de imagen y audio.`}</span>
            </span>
          </label>
          {task.status === 'review' && (
            <p className="text-destructive">
              REVISAR EL ENVIO INICIAL ANTES DE CONTINUAR.
            </p>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-destructive px-4 text-xs">
          {error}
        </p>
      )}
      {feedback && <p role="status" className="px-4 text-xs text-emerald-600">{feedback}</p>}
    </div>
  );
}
