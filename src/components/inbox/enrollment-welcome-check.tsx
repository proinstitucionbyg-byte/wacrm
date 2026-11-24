'use client';
import {RegisteredCorrectionEditor} from '@/components/enrollments/registered-correction-editor';
import { useCallback, useEffect, useState } from 'react';
import {CourseSelect} from '@/components/enrollments/course-select';
import { EnrollmentEvidenceEditor } from '@/components/enrollments/enrollment-evidence-editor';
import { Button } from '@/components/ui/button';
import { ENROLLMENT_FIELDS, parseEnrollmentData, enrollmentIssues, missingRequiredEnrollmentFields, type EnrollmentData } from '@/lib/matriculas/enrollment';
import { intakeEditorStorageKey, prepareIntakeDraft, sameIntakeData, readIntakeEditorDraft, rebaseIntakeEditorData, visibleIntakeFields, type EnrollmentField } from '@/lib/matriculas/intake-editor';
import type { ManualDocumentDelivery } from '@/lib/matriculas/manual-document-delivery';
interface IntakeDraft {
  id: string;
  version: number;
  data: EnrollmentData;
  issues: string[];
  can_edit: boolean;
  status?: string;
  error?: string | null;
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
interface EnrollmentProgress {
  error?: string | null;
  id: string;
  version: number;
  can_edit_delivery: boolean;
  manual_delivery: ManualDocumentDelivery;
  status: string;
  registered_number: string | null;
  student_folder_url: string | null;
  documents: Array<{ kind: string; status: string }>;
}
function explainIntakeIssue(issue: string): string {
  if (issue.startsWith('VERIFICAR IDENTIDAD:'))
    return 'Identidad pendiente: adjunta un documento, selecciona el respaldo del chat o usa «Datos por llamada / otro WhatsApp».';
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
  const [editedFields, setEditedFields] = useState<(keyof EnrollmentData)[]>([]);
  const [identityReviewed, setIdentityReviewed] = useState(false);
  const [offerReviewed, setOfferReviewed] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [enrollment, setEnrollment] = useState<EnrollmentProgress | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [intakeStep,setIntakeStep]=useState(0),[reviewAll,setReviewAll]=useState(false);
  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/enrollments/welcome?conversation=${conversationId}`
      );
      if (!res.ok) throw Error('No se pudo comprobar la bienvenida.');
      const data = await res.json();
      setTask(Array.isArray(data.tasks) ? (data.tasks[0] ?? null) : null);
      setEnrollment(data.enrollment ?? null);
      const nextIntake = data.intake ?? null;
      setIntake(nextIntake);
      setIntakeStep(0);setReviewAll(false);
      if (nextIntake) {
        const serverData = nextIntake.data ?? {};
        const cached = readIntakeEditorDraft(
          window.sessionStorage.getItem(intakeEditorStorageKey(nextIntake.id)),
          nextIntake.id,
          nextIntake.version
        );
        const draftData = cached?rebaseIntakeEditorData(serverData,cached.data,cached.editedFields??cached.confirmedFields as (keyof EnrollmentData)[]):serverData;
        setIntakeData(draftData);
        setConfirmedFields(cached?.confirmedFields ?? []);
        setIntakeFields(missingRequiredEnrollmentFields(draftData));
        setEditedFields(cached?.editedFields??[]);
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
      confirmedFields,editedFields,
    };
    window.sessionStorage.setItem(intakeEditorStorageKey(intake.id), JSON.stringify(draft));
  }, [intake, intakeData, confirmedFields,editedFields]);
  useEffect(() => {
    setTask(null);
    void Promise.resolve().then(load);
    // Load on chat selection only. Polling this card previously accumulated
    // duplicate DOM slots in the inbox on every refresh.
  }, [load]);
  useEffect(()=>{
    if(busy||!enrollment||!['ready','processing'].includes(enrollment.status))return;
    // Only follow an already-submitted job. Replace this one slot; never append cards.
    const timer=window.setTimeout(()=>void load(),5000);
    return()=>window.clearTimeout(timer);
  },[enrollment,busy,load]);
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
  async function markManualDelivery(sent: boolean) {
    if (!enrollment?.can_edit_delivery) return;
    setBusy('manual-delivery');
    setError('');
    try {
      const res = await fetch(`/api/enrollments/${enrollment.id}/manual-delivery`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sent, version: enrollment.version }),
      });
      const result = await res.json();
      if (!res.ok) throw Error(result.error ?? 'No se pudo guardar la entrega manual.');
      setEnrollment(current => current?.id === enrollment.id
        ? { ...current, version: result.version, manual_delivery: result.manual_delivery } : current);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar la entrega manual.');
    } finally {
      setBusy('');
    }
  }
  async function registerMissingIntake(submitAfter = true, overrideData?: EnrollmentData, overrideFields?: (keyof EnrollmentData)[]) {
    if (!intake) return;
    const missing = missingRequiredEnrollmentFields(intakeData);
    if (submitAfter && (missing.length || intakeFields.some((key) => !confirmedFields.includes(key) || !intakeData[key]?.trim()))) return;
    setBusy('intake');
    setError('');
    setFeedback('');
    try {
      let patch: Response;
      let saved: {
        error?: string;
        latest?: IntakeDraft | null;
        draft?: { data: EnrollmentData; version: number };
        issues?: string[];
      };
      const inputData=overrideData??intakeData;
      let dataToSave = prepareIntakeDraft(inputData,intake.data);
      const fieldsToSave=dataToSave===inputData?(overrideFields??editedFields):[...new Set<keyof EnrollmentData>([...(overrideFields??editedFields),'declaration_message_ids','identity_message_ids','identity_confirmed'])];
      let versionToSave = intake.version;
      for (let attempt = 0; ; attempt += 1) {
        patch = await fetch(`/api/enrollments/${intake.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: dataToSave, version: versionToSave }),
        });
        saved = await patch.json();
        if (patch.status !== 409 || saved.error !== 'Otra persona cambió la ficha. Actualiza antes de guardar.' || !saved.latest) break;
        const latestDraft = saved.latest;
        if (!latestDraft) break;
        if (!['collecting','error'].includes(latestDraft.status??'')) {
          const identical=sameIntakeData(parseEnrollmentData(latestDraft.data)??latestDraft.data,parseEnrollmentData(dataToSave)??dataToSave);
          await load();
          const progress=latestDraft.status==='registered'?'ya está registrada':latestDraft.status==='processing'?'se está registrando':'ya está en cola de registro';
          setFeedback('La matrícula '+progress+'. Consulté el estado sin repetir el trámite.');
          if(!identical)setError('El registro avanzó con datos diferentes a los cambios pendientes. Tus cambios se conservan en este navegador y no sobrescribieron el registro.');
          return true;
        }
        dataToSave = rebaseIntakeEditorData(latestDraft.data ?? {}, dataToSave, fieldsToSave);
        versionToSave = latestDraft.version;
        const nextFields = [...new Set([...intakeFields, ...missingRequiredEnrollmentFields(latestDraft.data ?? {})])];
        setIntake({ ...latestDraft, issues: enrollmentIssues(latestDraft.data ?? {}), can_edit: true });
        setIntakeFields(nextFields);
        setIntakeData(dataToSave);
        window.sessionStorage.setItem(intakeEditorStorageKey(intake.id), JSON.stringify({ intakeId: intake.id, baseVersion: versionToSave, data: dataToSave, confirmedFields }));
        if (attempt >= 2) throw Error('La ficha sigue cambiando en paralelo. Tus datos y casillas siguen en pantalla; espera unos segundos y pulsa GUARDAR Y CONTINUAR otra vez.');
        setError('La ficha cambió en paralelo. Conservé lo escrito y seleccionado; reintentando el guardado…');
      }
      if (!patch.ok) throw Error(saved.error ?? 'No se pudieron guardar los datos.');
      if (!saved.draft) throw Error('El servidor no devolvió la ficha guardada. Tus datos siguen en pantalla; vuelve a intentarlo.');
      setError('');
      setEditedFields([]);
      const savedIssues = saved.issues ?? [];
      setIntake({ ...intake, data: saved.draft.data, version: saved.draft.version, issues: savedIssues, can_edit: true });
      setIntakeData(saved.draft.data);
      window.sessionStorage.setItem(intakeEditorStorageKey(intake.id), JSON.stringify({ intakeId: intake.id, baseVersion: saved.draft.version, data: saved.draft.data, confirmedFields }));
      if (!submitAfter) { setFeedback('Borrador guardado. Todavía no se envió a registro.'); return true; }
      if (savedIssues.length) {
        setError(`Datos guardados. Aún no se envían documentos: ${savedIssues.map(explainIntakeIssue).join(' · ')}`);
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
      return false;
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
    setEditedFields((fields) => [...new Set<keyof EnrollmentData>([...fields, 'prices', 'promotion_id', 'offer_confirmed'])]);
    setOfferReviewed(false);
    setIntakeData((current) => ({ ...current, offer_confirmed: false }));
  }
  function toggleIdentityCandidate(id: string, checked: boolean) {
    setIntakeData((current) => {
      const ids = current.identity_message_ids ?? [];
      const identity_message_ids = checked ? [...new Set([...ids, id])] : ids.filter((value) => value !== id);
      return { ...current, identity_message_ids, declaration_message_ids: [], identity_confirmed: false };
    });
    setEditedFields((fields) => [...new Set<keyof EnrollmentData>([...fields, 'identity_message_ids', 'declaration_message_ids', 'identity_confirmed'])]);
    setIdentityReviewed(false);
  }
  const preparedIntakeData=intake?prepareIntakeDraft(intakeData,intake.data):intakeData;
  const currentIntakeIssues = intake ? enrollmentIssues(preparedIntakeData) : [];
  const hasUnsavedIntake=!!intake&&!sameIntakeData(intakeData,intake.data);
  const correctionFields:EnrollmentField[]=intake?.status==='error'?[
    ...(/^(LA|EL) (DOCENTE|PROFESOR|PROFESORA)\b/.test(intakeData.full_name??'')?['full_name' as const]:[]),
    ...(/CURSO/.test(intake.error??'')?['course' as const,'start_date' as const]:/FECHA|INICIO/.test(intake.error??'')?['start_date' as const]:[]),
  ]:[];
  const stepFields=reviewAll?(Object.keys(ENROLLMENT_FIELDS) as EnrollmentField[]):[...new Set([...correctionFields,...visibleIntakeFields(intakeFields)])];
  const currentStep=Math.min(intakeStep,stepFields.length);
  const currentField=stepFields[currentStep];
  const optionalField=!!currentField&&!missingRequiredEnrollmentFields({}).includes(currentField);
  function nextIntakeField(){
    if(currentField&&!optionalField&&!intakeData[currentField]?.trim())return;
    if(currentField&&intakeData[currentField]?.trim())setConfirmedFields(fields=>[...new Set([...fields,currentField])]);
    setIntakeStep(Math.min(currentStep+1,stepFields.length));
  }
  return (
    <div className="min-w-0 shrink-0" data-enrollment-welcome-slot>
      {intake && intake.can_edit && (
        <details className="mx-2 my-1 w-[calc(100%-1rem)] min-w-0 rounded-lg border border-amber-500/40 bg-background text-xs leading-normal" aria-label="Registrar datos faltantes de matrícula">
          <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between gap-2 px-3 py-1.5"><span className="font-semibold">Matrícula · {currentField?(currentField==='payment_date'?'fecha en que se realizó este pago':ENROLLMENT_FIELDS[currentField].toLocaleLowerCase('es')):'revisión final'}</span><span className={hasUnsavedIntake?'text-amber-400':'text-emerald-500'}>{hasUnsavedIntake?'Sin guardar':'Borrador guardado'}</span></summary>
          <div className="grid min-w-0 gap-x-4 gap-y-2 border-t border-amber-500/30 p-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <div className="min-w-0">
          <p className="mb-1 flex flex-wrap items-center justify-between gap-x-2 text-muted-foreground"><span>{currentField?"Dato "+(currentStep+1)+" de "+stepFields.length:'Respaldo y oferta'}</span><button type="button" className="underline underline-offset-2" disabled={!!busy} onClick={()=>{setReviewAll(!reviewAll);setIntakeStep(0);}}>{reviewAll?'Solo pendientes':'Otros datos'}</button></p>
          <div className="mt-2 min-w-0" onKeyDown={event=>{if(event.key==='Enter'&&!event.nativeEvent.isComposing&&(event.target as HTMLElement).tagName==='INPUT'){event.preventDefault();nextIntakeField();}}}>
            {stepFields.slice(currentStep,currentStep+1).map((key) => (
              <label key={key} className="min-w-0">
                <span className="sr-only">{ENROLLMENT_FIELDS[key]}</span>
                {key === 'course' ? <CourseSelect value={intakeData.course??''} disabled={!!busy} onChange={value=>{setIntakeData(current=>({...current,course:value,start_date:''}));setEditedFields(fields=>[...new Set([...fields,'course','start_date'] as (keyof EnrollmentData)[])]);setConfirmedFields(fields=>fields.filter(field=>field!=='course'&&field!=='start_date'));}}/> : key === 'document_type' ? (
                  <select disabled={busy === 'intake'} value={intakeData[key] ?? ''} onChange={(event) => { setIntakeData((current) => ({ ...current, [key]: event.target.value })); setEditedFields((fields) => [...new Set([...fields, key])]); setConfirmedFields((fields) => fields.filter((field) => field !== key)); }} className="mt-1 min-h-11 sm:min-h-9 w-full min-w-0 rounded border border-border bg-background px-2 text-base sm:text-sm">
                    <option value="">Seleccionar</option>{['DNI','CARNE DE EXTRANJERIA','PASAPORTE','OTRO'].map((type) => <option key={type}>{type}</option>)}
                  </select>
                ) : (
                  <input disabled={busy === 'intake'} type={['birth_date','start_date','payment_date'].includes(key) ? 'date' : key === 'email' ? 'email' : 'text'} value={intakeData[key] ?? ''} onChange={(event) => { setIntakeData((current) => ({ ...current, [key]: event.target.value })); setEditedFields((fields) => [...new Set([...fields, key])]); setConfirmedFields((fields) => fields.filter((field) => field !== key)); }} className="mt-1 min-h-11 sm:min-h-9 w-full min-w-0 rounded border border-border bg-background px-2 text-base sm:text-sm" />
                )}
                {confirmedFields.includes(key)&&<span className="sr-only">Dato confirmado</span>}
              </label>
            ))}
          </div>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2 md:justify-end" role="group" aria-label="Acciones de matrícula">
            <Button type="button" variant="outline" className="min-h-11 sm:min-h-9 flex-1 px-3 md:flex-none" disabled={!!busy||currentStep===0} onClick={()=>setIntakeStep(Math.max(0,currentStep-1))}>Atrás</Button>
            {currentField&&<Button type="button" className="min-h-11 sm:min-h-9 flex-1 px-3 md:flex-none" disabled={!!busy||(!optionalField&&!intakeData[currentField]?.trim())} title="Confirma este dato y avanza" onClick={nextIntakeField}>Siguiente</Button>}
          <Button type="button" variant="outline" className="min-h-11 sm:min-h-9 flex-1 border-primary/50 px-3 md:flex-none" disabled={!!busy} onClick={()=>void registerMissingIntake(false)}>{busy==='intake'?'Guardando…':'Guardar borrador'}</Button>
          </div>
          {currentField==='payment_date'&&<p className="text-xs text-muted-foreground md:col-span-2">Indica el día del depósito o transferencia que acaba de realizar el estudiante. Los vencimientos de las siguientes cuotas se calculan desde el inicio oficial del curso.</p>}
          {currentField==='start_date'&&<p className="text-xs text-muted-foreground md:col-span-2">Se completa desde el cuadro de inicios del curso. Puedes corregirlo manualmente si confirmaste otro inicio.</p>}
          {currentStep===stepFields.length&&<div className="max-h-[28dvh] min-w-0 space-y-2 overflow-y-auto overscroll-contain md:col-span-2" aria-label="Revisión final de matrícula">
          {!!(preparedIntakeData.declaration_message_ids?.length||preparedIntakeData.identity_message_ids?.length)&&<p role="status" className="rounded border border-emerald-500/40 p-2 text-emerald-600">✓ Respaldo guardado y asociado a esta matrícula.</p>}
          <EnrollmentEvidenceEditor key={intake.id} id={intake.id} version={intake.version} data={preparedIntakeData} disabled={!!busy} onChange={async patch => {
            const nextData={...intakeData,...patch};const nextFields=[...new Set<keyof EnrollmentData>([...editedFields,...Object.keys(patch) as (keyof EnrollmentData)[]])];
            setIntakeData(nextData);setEditedFields(nextFields);setIdentityReviewed(patch.identity_confirmed===true);
            if(!await registerMissingIntake(false,nextData,nextFields))throw Error('El archivo está guardado, pero no se pudo asociar a la ficha. Revisa el aviso antes de continuar.');
          }} />

          {intake.issues.some((issue) => issue.startsWith('VERIFICAR IDENTIDAD:')) && (
            <details className="mt-1 rounded border border-border px-1.5 py-1">
              <summary className="cursor-pointer font-semibold">Revisión de identidad · {intake.identity_candidates?.length ?? 0} fotos para revisar</summary>
              <div className="pt-1">
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
                    setEditedFields((fields) => [...new Set<keyof EnrollmentData>([...fields, 'identity_confirmed', 'identity_message_ids'])]);
                  }} /> Revisé la(s) foto(s) seleccionada(s) y coinciden con el nombre y documento escritos.</label>
                </>
              ) : <p>No hay una foto de identidad identificada en este chat. No marques la identidad como revisada; puedes adjuntarla o confirmar los datos por llamada en el apartado de arriba.</p>}
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
                        setEditedFields((fields) => [...new Set<keyof EnrollmentData>([...fields, 'declaration_message_ids', 'identity_message_ids', 'identity_confirmed'])]);
                        setIdentityReviewed(false);
                      }} />
                      <span>{new Date(candidate.created_at).toLocaleString('es-PE', { timeZone: 'America/Lima' })} · {candidate.content_text.slice(0, 180)}</span>
                    </label>)}
                  </div>
                  <p className="mt-1">Mensajes seleccionados: {intakeData.declaration_message_ids?.length ?? 0}/4. El servidor comprobará que contengan los tres datos.</p>
                </details>
              ) : null}
              </div>
            </details>
          )}
          {intake.issues.some((issue) => issue.startsWith('CONFIRMAR LA OFERTA')) && (
            <details className="mt-1 rounded border border-border px-1.5 py-1">
              <summary className="cursor-pointer font-semibold">Oferta recibida · completar 6 pagos</summary>
              <div className="pt-1">
              <p>Registra el primer pago y las cinco cuotas según el último bloque de promoción enviado en este chat.</p>
              <div className="mt-1 grid grid-cols-3 gap-1 sm:grid-cols-6">
                {Array.from({ length: 6 }, (_, index) => <label key={index} className="min-w-0">{index === 0 ? '1.er pago' : `Cuota ${index + 1}`}<input aria-label={index === 0 ? 'Primer pago' : `Cuota ${index + 1}`} type="number" min="0.01" step="0.01" value={intakeData.prices?.[index] ? String(intakeData.prices[index]) : ''} onChange={(event) => updatePrices(index, event.target.value)} className="mt-0.5 w-full rounded border border-border bg-background px-1 py-1" /></label>)}
              </div>
              <label className="mt-1 flex items-start gap-1"><input type="checkbox" className="mt-0.5 size-3" disabled={!intakeData.prices || intakeData.prices.length !== 6 || intakeData.prices.some((price) => !Number.isFinite(price) || price <= 0)} checked={offerReviewed} onChange={(event) => {
                const checked = event.target.checked;
                setOfferReviewed(checked);
                setIntakeData((current) => ({ ...current, offer_confirmed: checked, promotion_id: current.promotion_id || `OFERTA ${current.prices?.[0]?.toFixed(2)} + 5 CUOTAS ${current.prices?.[1]?.toFixed(2)}` }));
                setEditedFields((fields) => [...new Set<keyof EnrollmentData>([...fields, 'offer_confirmed', 'promotion_id'])]);
              }} /> Confirmé que estos son los seis pagos ofrecidos al estudiante.</label>
              </div>
            </details>
          )}
          {currentIntakeIssues.length>0&&<div className="rounded border border-amber-500/30 p-2"><p className="font-semibold">Falta para continuar:</p><ul className="ml-4 list-disc">{currentIntakeIssues.map(issue=><li key={issue}>{explainIntakeIssue(issue)}</li>)}</ul></div>}
          <Button size="sm" className="mt-1 min-h-11 w-full px-2 text-sm" disabled={busy === 'intake' || currentIntakeIssues.length > 0 || intakeFields.some((key) => !confirmedFields.includes(key) || !intakeData[key]?.trim())} onClick={() => void registerMissingIntake()}>{busy === 'intake' ? 'GUARDANDO…' : 'ENVIAR A REGISTRO'}</Button>
          </div>}
          {(error||intake.error||feedback)&&<div className="min-w-0 border-t border-border pt-1 text-xs md:col-span-2">
            {error?<p role="alert" className="break-words text-destructive">{error}</p>:intake.error?<details><summary className="cursor-pointer text-amber-400">Registro detenido · Ver motivo</summary><p className="mt-1 break-words text-muted-foreground">{intake.error}. Guardar borrador conserva los datos; para reintentar usa Enviar a registro al finalizar.</p></details>:null}
            {feedback&&<p role="status" className="text-emerald-500">{feedback}</p>}
          </div>}
          </div>
        </details>
      )}
      {intake?.issues.length && !intake.can_edit ? (
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
      {task && !intake && (
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
      {enrollment && enrollment.id!==intake?.id && (
        <div className="mx-2 my-1 flex max-w-2xl flex-wrap items-center gap-2 rounded border border-sky-500/40 bg-sky-500/5 px-2 py-1 text-[10px] leading-tight sm:mx-4">
          <span className="min-w-0 flex-1">
            <strong>
              {enrollment.status === 'registered'
                ? `MATRÍCULA ${enrollment.registered_number ?? 'REGISTRADA'}`
                : enrollment.status === 'error'
                  ? 'MATRÍCULA PENDIENTE DE REVISIÓN'
                  : 'MATRÍCULA EN PROCESO'}
            </strong>
            {enrollment.status === 'registered' && enrollment.documents.length > 0 && (
              <span className="ml-1 text-muted-foreground">
                · {enrollment.documents.map((document) => `${document.kind}: ${document.status}`).join(' · ')}
              </span>
            )}
          </span>
          <Button type="button" size="sm" variant="outline" className="h-6 shrink-0 px-2 text-[10px]" onClick={() => void load()} disabled={!!busy}>
            Actualizar
          </Button>
          {process.env.NEXT_PUBLIC_ENROLLMENT_CORRECTIONS_ENABLED === 'true'&&enrollment.status==='registered'&&enrollment.can_edit_delivery&&<RegisteredCorrectionEditor enrollmentId={enrollment.id}/>}
          {enrollment.error&&<p role="alert" className="w-full rounded border border-destructive/40 p-2 text-destructive">No se generaron los documentos: {enrollment.error}</p>}
          {enrollment.status === 'registered' && enrollment.student_folder_url && (
            <label className="flex items-center gap-1" title="Marca solo si ya enviaste boleta, cronograma y ficha por otro medio. Esta marca no envía mensajes ni confirma recepción.">
              <input type="checkbox" checked={enrollment.manual_delivery?.sent === true}
                disabled={!!busy || !enrollment.can_edit_delivery}
                onChange={event => void markManualDelivery(event.target.checked)} />
              <span>Enviados manualmente{enrollment.manual_delivery?.sent_at
                ? ` · ${new Date(enrollment.manual_delivery.sent_at).toLocaleString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ''}</span>
            </label>
          )}
          {enrollment.status === 'registered' && enrollment.student_folder_url && (
            <a
              className="shrink-0 font-semibold text-sky-600 underline"
              href={enrollment.student_folder_url}
              target="_blank"
              rel="noreferrer"
            >
              Descargar documentos
            </a>
          )}
        </div>
      )}
      {error && !intake && (
        <p role="alert" className="text-destructive px-4 text-xs">
          {error}
        </p>
      )}
      {feedback && !intake && <p role="status" className="px-4 text-xs text-emerald-600">{feedback}</p>}
    </div>
  );
}
