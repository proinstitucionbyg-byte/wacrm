'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ENROLLMENT_FIELDS, missingRequiredEnrollmentFields, type EnrollmentData } from '@/lib/matriculas/enrollment';
import { intakeEditorStorageKey, readIntakeEditorDraft, visibleIntakeFields, type EnrollmentField } from '@/lib/matriculas/intake-editor';
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
  const [intakeFields, setIntakeFields] = useState<EnrollmentField[]>([]);
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
      const nextIntake = data.intake ?? null;
      setIntake(nextIntake);
      if (nextIntake) {
        const serverData = nextIntake.data ?? {};
        const cached = readIntakeEditorDraft(
          window.sessionStorage.getItem(intakeEditorStorageKey(nextIntake.id)),
          nextIntake.id,
          nextIntake.version
        );
        const draftData = cached?.data ?? serverData;
        setIntakeData(draftData);
        setConfirmedFields(cached?.confirmedFields ?? []);
        setIntakeFields(missingRequiredEnrollmentFields(serverData));
      } else {
        setIntakeData({});
        setConfirmedFields([]);
        setIntakeFields([]);
      }
      setNow(Date.now());
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar.');
    }
  }, [conversationId]);
  useEffect(() => {
    if (!intake) return;
    const draft = {
      intakeId: intake.id,
      baseVersion: intake.version,
      data: intakeData,
      confirmedFields,
    };
    window.sessionStorage.setItem(intakeEditorStorageKey(intake.id), JSON.stringify(draft));
  }, [intake, intakeData, confirmedFields]);
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
    if (missing.length || intakeFields.some((key) => !confirmedFields.includes(key) || !intakeData[key]?.trim())) return;
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
        window.sessionStorage.setItem(intakeEditorStorageKey(intake.id), JSON.stringify({ intakeId: intake.id, baseVersion: saved.draft.version, data: saved.draft.data, confirmedFields }));
        setError(`Datos guardados. Aún no se envían documentos: ${saved.issues.join(' · ')}`);
        return;
      }
      const submit = await fetch(`/api/enrollments/${intake.id}/submit`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: saved.draft.version }),
      });
      const result = await submit.json();
      if (!submit.ok) throw Error(result.error ?? 'No se pudo enviar a registro.');
      window.sessionStorage.removeItem(intakeEditorStorageKey(intake.id));
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
      {intake && intake.can_edit && intakeFields.length > 0 && (
        <section className="mx-2 my-1 rounded-lg border border-amber-500/50 bg-background p-2 text-[11px] leading-tight sm:mx-4" aria-label="Registrar datos faltantes de matrícula">
          <strong>DATOS FALTANTES · SOLO PARA COMPLETAR LO QUE YA FALTA</strong>
          <p className="mt-1 text-muted-foreground">Completa lo pendiente y marca cada dato solo después de cotejarlo con el chat. Dirección y segundo celular son opcionales. Esto guarda los datos; no confirma identidad ni emite documentos.</p>
          <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
            {visibleIntakeFields(intakeFields).map((key) => (
              <label key={key} className="min-w-0">
                <span className="font-medium">{ENROLLMENT_FIELDS[key]}</span>
                {key === 'document_type' ? (
                  <select disabled={busy === 'intake'} value={intakeData[key] ?? ''} onChange={(event) => { setIntakeData((current) => ({ ...current, [key]: event.target.value })); setConfirmedFields((fields) => fields.filter((field) => field !== key)); }} className="mt-0.5 w-full rounded border border-border bg-background px-2 py-1.5">
                    <option value="">Seleccionar</option>{['DNI','CARNE DE EXTRANJERIA','PASAPORTE','OTRO'].map((type) => <option key={type}>{type}</option>)}
                  </select>
                ) : (
                  <input disabled={busy === 'intake'} type={['birth_date','start_date','payment_date'].includes(key) ? 'date' : key === 'email' ? 'email' : 'text'} value={intakeData[key] ?? ''} onChange={(event) => { setIntakeData((current) => ({ ...current, [key]: event.target.value })); setConfirmedFields((fields) => fields.filter((field) => field !== key)); }} className="mt-0.5 w-full rounded border border-border bg-background px-2 py-1.5" />
                )}
                <span className="mt-1 flex min-h-5 items-center gap-1.5"><input className="size-3.5" type="checkbox" disabled={busy === 'intake' || !intakeData[key]?.trim()} checked={confirmedFields.includes(key)} onChange={(event) => setConfirmedFields((fields) => event.target.checked ? [...new Set([...fields,key])] : fields.filter((field) => field !== key))} /> Confirmé que coincide con el chat</span>
              </label>
            ))}
          </div>
          <Button size="sm" className="mt-1.5 h-8 px-2.5 text-xs" disabled={busy === 'intake' || missingRequiredEnrollmentFields(intakeData).length > 0 || intakeFields.some((key) => !confirmedFields.includes(key) || !intakeData[key]?.trim())} onClick={() => void registerMissingIntake()}>{busy === 'intake' ? 'GUARDANDO…' : 'GUARDAR Y CONTINUAR'}</Button>
        </section>
      )}
      {intake?.issues.length ? (
        <div className="mx-2 my-1 rounded border border-amber-500/30 p-2 text-[11px] leading-tight text-amber-700 sm:mx-4">
          <strong>ANTES DE ENVIAR A REGISTRO</strong>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {intake.issues
              .filter((issue) => {
                if (!issue.startsWith('FALTA ')) return true;
                const key = Object.entries(ENROLLMENT_FIELDS).find(([, label]) => issue === `FALTA ${label}`)?.[0] as keyof EnrollmentData | undefined;
                const value = key ? intakeData[key] : undefined;
                return typeof value !== 'string' || !value.trim();
              })
              .map((issue) => (
                <li key={issue}>
                  {issue.startsWith('VERIFICAR IDENTIDAD:')
                    ? 'Identidad pendiente: en Registro de Matrículas revisa la foto del documento. Si no hay foto, el chat debe contener nombre, documento y correo escritos por el estudiante para guardar ese respaldo. Marcar un dato aquí no confirma la identidad.'
                    : issue.startsWith('CONFIRMAR LA OFERTA')
                      ? 'Promoción pendiente: confirma el bloque de seis cuotas que realmente recibió el estudiante.'
                      : issue}
                </li>
              ))}
          </ul>
          <Link className="mt-1 inline-block underline" href="/enrollments">Abrir Registro de Matrículas para completar la revisión</Link>
        </div>
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
