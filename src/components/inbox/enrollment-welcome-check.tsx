'use client';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ENROLLMENT_FIELDS, enrollmentIssues, missingRequiredEnrollmentFields, type EnrollmentData } from '@/lib/matriculas/enrollment';
import { intakeEditorStorageKey, readIntakeEditorDraft, rebaseIntakeEditorData, visibleIntakeFields, type EnrollmentField } from '@/lib/matriculas/intake-editor';
interface IntakeDraft {
  id: string;
  version: number;
  data: EnrollmentData;
  issues: string[];
  can_edit: boolean;
  status?: string;
  identity_candidates?: Array<{
    id: string;
    created_at: string;
    category: string | null;
    fields: Record<string, unknown>;
  }>;
  declaration_candidates?: Array<{ id: string; created_at: string; content_text: string }>;
}
interface WelcomeTask {
  id: string;
  stage?: string;
  welcome_due_at: string;
  completed_at: string | null;
  backup_sent_at: string | null;
  status: string;
}
function explainIntakeIssue(issue: string): string {
  if (issue.startsWith('VERIFICAR IDENTIDAD:'))
    return 'Identidad pendiente: selecciona las fotos del documento y confirma que las revisaste, o selecciona mensajes escritos que juntos contengan nombre, documento y correo.';
  if (issue.startsWith('CONFIRMAR LA OFERTA'))
    return 'Oferta pendiente: registra el primer pago y las cinco cuotas del último bloque enviado y marca la confirmación.';
  return issue;
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
  const [editedFields, setEditedFields] = useState<EnrollmentField[]>([]);
  const [identityReviewed, setIdentityReviewed] = useState(false);
  const [offerReviewed, setOfferReviewed] = useState(false);
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
        setIdentityReviewed(Boolean(draftData.identity_confirmed && draftData.identity_message_ids?.length));
        setOfferReviewed(Boolean(draftData.offer_confirmed && draftData.prices?.length === 6));
      } else {
        setIntakeData({});
        setConfirmedFields([]);
        setIntakeFields([]);
        setIdentityReviewed(false);
        setOfferReviewed(false);
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
      let patch = await fetch(`/api/enrollments/${intake.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: intakeData, version: intake.version }),
      });
      let saved = await patch.json();
      if (patch.status === 409 && saved.error === 'Otra persona cambió la ficha. Actualiza antes de guardar.') {
        const latestDraft = saved.latest as IntakeDraft | null;
        if (!latestDraft) throw Error('No se pudo actualizar la ficha. Tus datos siguen guardados en este navegador.');
        const rebasedData = rebaseIntakeEditorData(latestDraft.data ?? {}, intakeData, editedFields);
        const nextFields = [...new Set([...intakeFields, ...missingRequiredEnrollmentFields(latestDraft.data ?? {})])];
        const latestIssues = enrollmentIssues(latestDraft.data ?? {});
        setIntake({ ...latestDraft, issues: latestIssues, can_edit: latestDraft.status === 'collecting' });
        setIntakeFields(nextFields);
        setIntakeData(rebasedData);
        window.sessionStorage.setItem(intakeEditorStorageKey(intake.id), JSON.stringify({ intakeId: intake.id, baseVersion: latestDraft.version, data: rebasedData, confirmedFields }));
        if (latestDraft.status !== 'collecting') throw Error('La ficha avanzó a registro mientras la completabas. Conservé tus datos en este navegador, pero no los envié para evitar duplicar el trámite.');
        setError('La ficha se actualizó en paralelo. Conservé lo que escribiste y estoy guardándolo sobre la versión nueva…');
        patch = await fetch(`/api/enrollments/${intake.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: rebasedData, version: latestDraft.version }),
        });
        saved = await patch.json();
      }
      if (!patch.ok) throw Error(saved.error ?? 'No se pudieron guardar los datos.');
      setError('');
      setEditedFields([]);
      setIntake({ ...intake, data: saved.draft.data, version: saved.draft.version, issues: saved.issues, can_edit: true });
      setIntakeData(saved.draft.data);
      window.sessionStorage.setItem(intakeEditorStorageKey(intake.id), JSON.stringify({ intakeId: intake.id, baseVersion: saved.draft.version, data: saved.draft.data, confirmedFields }));
      if (saved.issues?.length) {
        setError(`Datos guardados. Aún no se envían documentos: ${saved.issues.map(explainIntakeIssue).join(' · ')}`);
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
  function updatePrices(index: number, value: string) {
    setIntakeData((current) => {
      const prices = Array.from({ length: 6 }, (_, i) => current.prices?.[i] ?? 0);
      prices[index] = value.trim() ? Number(value) : 0;
      return { ...current, prices };
    });
    setEditedFields((fields) => [...new Set([...fields, 'promotion_id' as EnrollmentField])]);
    setOfferReviewed(false);
    setIntakeData((current) => ({ ...current, offer_confirmed: false }));
  }
  function toggleIdentityCandidate(id: string, checked: boolean) {
    setIntakeData((current) => {
      const ids = current.identity_message_ids ?? [];
      const identity_message_ids = checked ? [...new Set([...ids, id])] : ids.filter((value) => value !== id);
      return { ...current, identity_message_ids, declaration_message_ids: [], identity_confirmed: false };
    });
    setIdentityReviewed(false);
  }
  const currentIntakeIssues = intake ? enrollmentIssues(intakeData) : [];
  return (
    <div className="contents" data-enrollment-welcome-slot>
      {intake && intake.can_edit && (intakeFields.length > 0 || intake.issues.some((issue) => issue.startsWith('VERIFICAR IDENTIDAD:') || issue.startsWith('CONFIRMAR LA OFERTA'))) && (
        <section className="mx-2 my-1 w-full max-w-2xl rounded-lg border border-amber-500/50 bg-background p-1.5 text-[10px] leading-tight sm:mx-4" aria-label="Registrar datos faltantes de matrícula">
          <strong>DATOS FALTANTES · SOLO PARA COMPLETAR LO QUE YA FALTA</strong>
          <p className="mt-0.5 text-muted-foreground">Completa aquí los pendientes y verifica cada dato con el chat. Dirección y segundo celular son opcionales. La revisión de identidad y la oferta se completan en este mismo cuadro.</p>
          <div className="mt-1 grid gap-1 sm:grid-cols-2">
            {visibleIntakeFields(intakeFields).map((key) => (
              <label key={key} className="min-w-0">
                <span className="font-medium">{ENROLLMENT_FIELDS[key]}</span>
                {key === 'document_type' ? (
                  <select disabled={busy === 'intake'} value={intakeData[key] ?? ''} onChange={(event) => { setIntakeData((current) => ({ ...current, [key]: event.target.value })); setEditedFields((fields) => [...new Set([...fields, key])]); setConfirmedFields((fields) => fields.filter((field) => field !== key)); }} className="mt-0.5 w-full rounded border border-border bg-background px-1.5 py-1 text-[11px]">
                    <option value="">Seleccionar</option>{['DNI','CARNE DE EXTRANJERIA','PASAPORTE','OTRO'].map((type) => <option key={type}>{type}</option>)}
                  </select>
                ) : (
                  <input disabled={busy === 'intake'} type={['birth_date','start_date','payment_date'].includes(key) ? 'date' : key === 'email' ? 'email' : 'text'} value={intakeData[key] ?? ''} onChange={(event) => { setIntakeData((current) => ({ ...current, [key]: event.target.value })); setEditedFields((fields) => [...new Set([...fields, key])]); setConfirmedFields((fields) => fields.filter((field) => field !== key)); }} className="mt-0.5 w-full rounded border border-border bg-background px-1.5 py-1 text-[11px]" />
                )}
                <span className="mt-0.5 flex min-h-4 items-center gap-1"><input className="size-3" type="checkbox" disabled={busy === 'intake' || !intakeData[key]?.trim()} checked={confirmedFields.includes(key)} onChange={(event) => setConfirmedFields((fields) => event.target.checked ? [...new Set([...fields,key])] : fields.filter((field) => field !== key))} /> Verificado en chat</span>
              </label>
            ))}
          </div>
          {intake.issues.some((issue) => issue.startsWith('VERIFICAR IDENTIDAD:')) && (
            <fieldset className="mt-1 rounded border border-border p-1.5">
              <legend className="px-1 font-semibold">Revisión de identidad</legend>
              {intake.identity_candidates?.length ? (
                <>
                  <p>Marca la(s) foto(s) del documento que revisaste en el chat. La lectura automática es solo una sugerencia.</p>
                  <div className="mt-1 grid gap-1 sm:grid-cols-2">
                    {intake.identity_candidates.map((candidate) => {
                      const fields = candidate.fields;
                      const hint = [fields.document_type, fields.document_number, fields.full_name].filter((value) => typeof value === 'string' && value.trim()).join(' · ');
                      return <label key={candidate.id} className="flex items-start gap-1 rounded border border-border p-1">
                        <input type="checkbox" className="mt-0.5 size-3" checked={intakeData.identity_message_ids?.includes(candidate.id) ?? false} onChange={(event) => toggleIdentityCandidate(candidate.id, event.target.checked)} />
                        <span>Foto recibida {new Date(candidate.created_at).toLocaleString('es-PE', { timeZone: 'America/Lima' })}{hint ? ` · Lectura IA: ${hint}` : ' · Sin lectura automática'}</span>
                      </label>;
                    })}
                  </div>
                  <label className="mt-1 flex items-start gap-1"><input type="checkbox" className="mt-0.5 size-3" disabled={!intakeData.identity_message_ids?.length} checked={identityReviewed} onChange={(event) => {
                    const checked = event.target.checked;
                    setIdentityReviewed(checked);
                    setIntakeData((current) => ({ ...current, identity_confirmed: checked, identity_message_ids: checked ? current.identity_message_ids : [] }));
                  }} /> Revisé la(s) foto(s) seleccionada(s) y coinciden con el nombre y documento escritos.</label>
                </>
              ) : <p>No hay una foto de identidad identificada en este chat. No marques la identidad como revisada; solicita o adjunta la evidencia desde este mismo chat.</p>}
              {intake.declaration_candidates?.length ? (
                <details className="mt-1">
                  <summary className="cursor-pointer font-medium">O usar el respaldo escrito del estudiante</summary>
                  <p>Selecciona hasta cuatro mensajes que, juntos, muestren nombre completo, documento y correo escritos por el estudiante.</p>
                  <div className="mt-1 max-h-28 space-y-1 overflow-auto">
                    {intake.declaration_candidates.map((candidate) => <label key={candidate.id} className="flex items-start gap-1 rounded border border-border p-1">
                      <input type="checkbox" className="mt-0.5 size-3" checked={intakeData.declaration_message_ids?.includes(candidate.id) ?? false} onChange={(event) => {
                        const selected = intakeData.declaration_message_ids ?? [];
                        const ids = event.target.checked ? [...new Set([...selected, candidate.id])] : selected.filter((value) => value !== candidate.id);
                        setIntakeData((current) => ({ ...current, declaration_message_ids: ids.slice(0, 4), identity_message_ids: [], identity_confirmed: false }));
                        setIdentityReviewed(false);
                      }} />
                      <span>{new Date(candidate.created_at).toLocaleString('es-PE', { timeZone: 'America/Lima' })} · {candidate.content_text.slice(0, 180)}</span>
                    </label>)}
                  </div>
                  <p className="mt-1">Mensajes seleccionados: {intakeData.declaration_message_ids?.length ?? 0}/4. El servidor comprobará que contengan los tres datos.</p>
                </details>
              ) : null}
            </fieldset>
          )}
          {intake.issues.some((issue) => issue.startsWith('CONFIRMAR LA OFERTA')) && (
            <fieldset className="mt-1 rounded border border-border p-1.5">
              <legend className="px-1 font-semibold">Oferta que recibió · 6 pagos</legend>
              <p>Registra el primer pago y las cinco cuotas según el último bloque de promoción enviado en este chat.</p>
              <div className="mt-1 grid grid-cols-3 gap-1 sm:grid-cols-6">
                {Array.from({ length: 6 }, (_, index) => <label key={index} className="min-w-0">{index === 0 ? '1.er pago' : `Cuota ${index + 1}`}<input aria-label={index === 0 ? 'Primer pago' : `Cuota ${index + 1}`} type="number" min="0.01" step="0.01" value={intakeData.prices?.[index] ? String(intakeData.prices[index]) : ''} onChange={(event) => updatePrices(index, event.target.value)} className="mt-0.5 w-full rounded border border-border bg-background px-1 py-1" /></label>)}
              </div>
              <label className="mt-1 flex items-start gap-1"><input type="checkbox" className="mt-0.5 size-3" disabled={!intakeData.prices || intakeData.prices.length !== 6 || intakeData.prices.some((price) => !Number.isFinite(price) || price <= 0)} checked={offerReviewed} onChange={(event) => {
                const checked = event.target.checked;
                setOfferReviewed(checked);
                setIntakeData((current) => ({ ...current, offer_confirmed: checked, promotion_id: current.promotion_id || `OFERTA ${current.prices?.[0]?.toFixed(2)} + 5 CUOTAS ${current.prices?.[1]?.toFixed(2)}` }));
              }} /> Confirmé que estos son los seis pagos ofrecidos al estudiante.</label>
            </fieldset>
          )}
          <Button size="sm" className="mt-1 h-7 px-2 text-[11px]" disabled={busy === 'intake' || currentIntakeIssues.length > 0 || intakeFields.some((key) => !confirmedFields.includes(key) || !intakeData[key]?.trim())} onClick={() => void registerMissingIntake()}>{busy === 'intake' ? 'GUARDANDO…' : 'GUARDAR Y CONTINUAR'}</Button>
        </section>
      )}
      {intake?.issues.length ? (
        <div className="mx-2 my-1 w-full max-w-2xl rounded border border-amber-500/30 p-1.5 text-[10px] leading-tight text-amber-700 sm:mx-4">
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
                  {explainIntakeIssue(issue)}
                </li>
              ))}
          </ul>
        </div>
      ) : null}
      {task && (
        <div
          data-enrollment-welcome-id={task.id}
          className="mx-2 my-1 w-full max-w-2xl rounded-lg border border-sky-500/40 bg-sky-500/10 p-1.5 text-[10px] leading-tight sm:mx-4 sm:my-1.5"
        >
          {task.stage === 'provisional' && (
            <div className="mb-1 rounded border border-amber-500 bg-amber-500/15 p-1.5">
              <strong className="text-[10px]">
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
