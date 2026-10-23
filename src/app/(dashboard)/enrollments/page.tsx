'use client';
import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {ManualEnrollment} from '@/components/enrollments/manual-enrollment';
import {
  ENROLLMENT_FIELDS,
  missingRequiredEnrollmentFields,
  suggestIdentityData,
  type EnrollmentData,
  type EnrollmentDraft,
} from '@/lib/matriculas/enrollment';
import { restoreEnrollmentEditorData } from '@/lib/matriculas/editor-draft';

type Evidence = {
  id: string;
  media_url: string | null;
  image_analysis: {
    category?: string;
    summary?: string;
    fields?: Record<string, string | null>;
  } | null;
};
function EnrollmentEditor({
  initial,
  canEdit,
}: {
  initial: EnrollmentDraft;
  canEdit: boolean;
}) {
  const [draft, setDraft] = useState(initial);
  const [data, setData] = useState<EnrollmentData>(initial.data);
  const [images, setImages] = useState<Evidence[]>([]);
  const [documents, setDocuments] = useState<
    { kind: string; status: string; error: string | null }[]
  >([]);
  const [issues, setIssues] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [collecting, setCollecting] = useState(true);
  const [hydrated, setHydrated] = useState(false);
  const [recovered, setRecovered] = useState(false);
  const [confirmedMissing, setConfirmedMissing] = useState<string[]>([]);
  const [missingFields, setMissingFields] = useState<(keyof typeof ENROLLMENT_FIELDS)[]>([]);
  const cacheKey = `wacrm:enrollment:editor:${initial.id}`;
  useEffect(() => {
    let cancelled = false;
    setCollecting(true);
    (canEdit
      ? fetch(`/api/enrollments/${initial.id}/collect`, { method: 'POST' })
      : Promise.resolve(null)
    )
      .then(async (res) => {
        if (res && !res.ok) throw new Error((await res.json()).error);
        return fetch(`/api/enrollments/${initial.id}`, { cache: 'no-store' });
      })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error);
        if (cancelled) return;
        let restored: ReturnType<typeof restoreEnrollmentEditorData> = {
          data: json.draft.data as EnrollmentData,
          restored: false,
          confirmedMissing: [],
        };
        if (canEdit && json.draft.status === 'collecting') {
          try { restored = restoreEnrollmentEditorData(json.draft.data, sessionStorage.getItem(cacheKey)); } catch { /* Private browsing may disable storage. */ }
        }
        setDraft(json.draft);
        setData(restored.data);
        const nextMissingFields = missingRequiredEnrollmentFields(json.draft.data);
        setMissingFields(nextMissingFields);
        setConfirmedMissing(restored.confirmedMissing.filter((key) => nextMissingFields.includes(key) && Boolean(restored.data[key]?.trim())));
        setRecovered(restored.restored);
        setHydrated(true);
        setImages(json.images);
        setDocuments(json.documents ?? []);
        setIssues(json.issues);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setCollecting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [initial.id, initial.version, canEdit, cacheKey]);
  const locked =
    !canEdit || ['ready', 'processing', 'registered'].includes(draft.status);
  const hasIdentityPhotos = Boolean(data.identity_message_ids?.length);
  const hasWrittenEvidence = Boolean(data.declaration_message_ids?.length);
  const identityCheckId = `identity-check-${draft.id}`;
  const dirty = JSON.stringify(data) !== JSON.stringify(draft.data);
  useEffect(() => {
    if (!hydrated || !canEdit) return;
    try {
      if ((dirty || confirmedMissing.length > 0) && !locked) sessionStorage.setItem(cacheKey, JSON.stringify({ baseData: draft.data, data, confirmedMissing, savedAt: Date.now() }));
      else sessionStorage.removeItem(cacheKey);
    } catch { /* Keep editing if storage is unavailable. */ }
  }, [hydrated, canEdit, dirty, locked, cacheKey, draft.data, data, confirmedMissing]);
  useEffect(() => {
    if (!dirty || locked) return;
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [dirty, locked]);
  async function collectSelected() {
    setSaving(true);setError('');
    try {
      const response = await fetch(`/api/enrollments/${draft.id}/collect`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({selected:true,version:draft.version})});
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      const refreshed = await fetch(`/api/enrollments/${draft.id}`,{cache:'no-store'});
      const json = await refreshed.json();
      if (!refreshed.ok) throw new Error(json.error);
      setDraft(json.draft);setData(json.draft.data);setMissingFields(missingRequiredEnrollmentFields(json.draft.data));setConfirmedMissing([]);setIssues(json.issues);setImages(json.images);setDocuments(json.documents??[]);
      toast.success('Datos recogidos para esta ficha y su comprobante.');
    } catch(error) {setError(error instanceof Error?error.message:'No se pudo recoger la ficha.');}
    finally {setSaving(false);}
  }
  async function enqueue() {
    setSaving(true);
    try {
      const res = await fetch(`/api/enrollments/${draft.id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: draft.version }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setDraft(json.draft);
      setError('');
      toast.success(
        'Ficha en cola de registro. Todavía no confirma documentos enviados.'
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo enviar');
    } finally {
      setSaving(false);
    }
  }
  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/enrollments/${draft.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data, version: draft.version }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setDraft(json.draft);
      setData(json.draft.data);
      setMissingFields(missingRequiredEnrollmentFields(json.draft.data));
      setRecovered(false);
      setConfirmedMissing([]);
      setIssues(json.issues);
      setError('');
      toast.success('Datos guardados. El pago conserva su validación.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  }
  async function registerMissingData() {
    if (missingFields.some((key) => !confirmedMissing.includes(key) || !data[key]?.trim())) return;
    setSaving(true);
    setError('');
    try {
      const savedResponse = await fetch(`/api/enrollments/${draft.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data, version: draft.version }),
      });
      const saved = await savedResponse.json();
      if (!savedResponse.ok) throw new Error(saved.error);
      setDraft(saved.draft);
      setData(saved.draft.data);
      setMissingFields(missingRequiredEnrollmentFields(saved.draft.data));
      setIssues(saved.issues);
      setRecovered(false);
      setConfirmedMissing([]);
      if (saved.issues.length) {
        toast.success('Datos confirmados y guardados. La revisión humana pendiente sigue protegida.');
        return;
      }
      const submitResponse = await fetch(`/api/enrollments/${draft.id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: saved.draft.version }),
      });
      const submitted = await submitResponse.json();
      if (!submitResponse.ok) throw new Error(submitted.error);
      setDraft(submitted.draft);
      setIssues(submitted.issues ?? []);
      toast.success('Datos completos. Ficha enviada a la cola de registro; confirma el envío de documentos en su estado.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron registrar los datos faltantes.');
    } finally {
      setSaving(false);
    }
  }
  function updateMissingField(key: keyof typeof ENROLLMENT_FIELDS, value: string) {
    setData((current) => ({ ...current, [key]: value }));
    setConfirmedMissing((current) => current.filter((field) => field !== key));
  }
  if (collecting)
    return <p className="p-5 text-sm">RECOGIENDO LOS DATOS DEL CHAT...</p>;
  return (
    <article className="border-border bg-card space-y-4 rounded-lg border p-5">
      <h2 className="font-semibold">
        {data.full_name || 'MATRICULA CON DATOS PENDIENTES'}
      </h2>
      <p className="text-muted-foreground text-xs">{data.course || 'CURSO PENDIENTE'} · OPERACIÓN {draft.operation_reference || 'POR CONFIRMAR'}</p>
      {recovered && dirty && <p role="status" className="rounded border border-amber-500/40 p-2 text-xs">Recuperé los cambios sin guardar de esta pestaña. Revisa la ficha y pulsa Guardar datos.</p>}
      {!locked && <div className="flex flex-wrap items-center gap-3"><Button variant="outline" disabled={saving || dirty || !data.course} onClick={collectSelected}>Recoger datos para esta matrícula</Button><p className="text-muted-foreground text-xs">Si tiene varias matrículas, guarda primero el curso en la ficha correspondiente a este comprobante.</p></div>}
      {!canEdit && (
        <p className="text-muted-foreground text-sm">
          Acceso de consulta. No tienes permiso para modificar esta matrícula.
        </p>
      )}
      <p className="text-muted-foreground text-sm">
        PAGO VALIDADO ·{' '}
        {draft.status === 'registered'
          ? `REGISTRO ${draft.registered_number}`
          : draft.status === 'processing'
            ? 'REGISTRANDO'
            : draft.status === 'ready'
              ? 'EN COLA PARA GOOGLE'
              : 'COMPLETAR DATOS'}
      </p>
      {draft.status === 'collecting' && issues.length > 0 && (
        <section className="rounded border border-amber-500/40 p-3" aria-label="Observación para fidelización">
          <h3 className="text-sm font-semibold">OBSERVACIÓN PARA FIDELIZACIÓN</h3>
          <p className="mt-1 text-xs">El pago ya fue validado. Revisar lo recibido, llamar para pedir solo los datos realmente ausentes y completar esta ficha. Los documentos se emitirán al cerrar el registro.</p>
          <ul className="mt-2 list-disc pl-5 text-xs">
            {issues.map((issue) => <li key={issue}>{issue}</li>)}
          </ul>
        </section>
      )}
      {draft.error && (
        <p role="alert" className="text-red-400">
          REVISAR REGISTRO: {draft.error}
        </p>
      )}
      {draft.status === 'ready' && (
        <p className="text-muted-foreground text-sm">
          El programa de Google procesará esta ficha cuando la conexión esté
          instalada y activa. Este estado todavía no acredita registro ni
          entrega de PDF.
        </p>
      )}
      {draft.status === 'registered' && (
        <section className="border-border rounded border p-3">
          <h3 className="mb-2 text-sm font-semibold">
            DOCUMENTOS EN EL CHAT DEL ESTUDIANTE
          </h3>
          <div className="grid gap-2 sm:grid-cols-3">
            {['BOLETA', 'CRONOGRAMA', 'FICHA'].map((kind) => {
              const item = documents.find((d) => d.kind === kind);
              return (
                <div key={kind} className="bg-muted rounded p-2 text-xs">
                  <strong>{kind}</strong>
                  <p>
                    {item?.status === 'sent'
                      ? 'ENVIADO'
                      : item?.status === 'review'
                        ? 'REQUIERE REVISION'
                        : item?.status === 'sending'
                          ? 'ENVIO INICIADO'
                          : 'ESPERANDO PDF'}
                  </p>
                  {item?.error && (
                    <p className="mt-1 text-red-400">{item.error}</p>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}
      {!locked && draft.status === 'collecting' && missingFields.length > 0 && (
        <section className="rounded-lg border border-primary/30 p-2.5 sm:p-3" aria-label="Completar solo los datos faltantes">
          <h3 className="text-sm font-semibold">COMPLETAR SOLO LOS DATOS QUE FALTAN</h3>
          <p className="mt-1 text-xs text-muted-foreground">Completa los datos que falten según la conversación. Cada casilla se mantiene en pantalla hasta guardar, para que al elegir el tipo de documento no se muevan los campos. Marca “Dato confirmado” después de revisar. Dirección y segundo celular no son obligatorios.</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {missingFields.map((key) => (
              <div key={key} className="min-w-0 rounded-md border border-border/70 p-2 text-xs">
                <label htmlFor={`missing-${key}`}>
                {ENROLLMENT_FIELDS[key]}
                {key === 'document_type' ? (
                  <select id={`missing-${key}`} disabled={saving} value={data[key] ?? ''} onChange={(event) => updateMissingField(key, event.target.value)} className="border-border bg-background mt-1 block w-full rounded border px-2 py-1.5">
                    <option value="">Seleccionar</option>
                    {['DNI', 'CARNE DE EXTRANJERIA', 'PASAPORTE', 'OTRO'].map((type) => <option key={type}>{type}</option>)}
                  </select>
                ) : (
                  <input id={`missing-${key}`} disabled={saving} type={['birth_date', 'start_date', 'payment_date'].includes(key) ? 'date' : key === 'email' ? 'email' : 'text'} value={data[key] ?? ''} onChange={(event) => updateMissingField(key, event.target.value)} className="border-border bg-background mt-1 block w-full rounded border px-2 py-1.5" />
                )}
                </label>
                <label htmlFor={`confirmed-${key}`} className="mt-1.5 flex min-h-7 cursor-pointer items-center gap-2">
                  <input id={`confirmed-${key}`} type="checkbox" className="size-4 shrink-0 accent-primary" disabled={saving || !data[key]?.trim()} checked={confirmedMissing.includes(key)} onChange={(event) => setConfirmedMissing((current) => event.target.checked ? [...new Set([...current, key])] : current.filter((item) => item !== key))} />
                  Dato confirmado
                </label>
              </div>
            ))}
          </div>
          <Button className="mt-2 h-8 px-3 text-xs" disabled={saving || missingFields.some((key) => !confirmedMissing.includes(key) || !data[key]?.trim())} onClick={registerMissingData}>
            {saving ? 'GUARDANDO…' : 'REGISTRAR DATOS FALTANTES'}
          </Button>
        </section>
      )}
      {draft.conversation_id && (
        <Link
          href={`/inbox?c=${draft.conversation_id}`}
          className="text-sm underline"
        >
          Abrir conversación y comparar los datos escritos
        </Link>
      )}
      {error && (
        <p role="alert" className="text-red-400">
          {error}
        </p>
      )}
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {(
          Object.entries(ENROLLMENT_FIELDS) as [
            keyof typeof ENROLLMENT_FIELDS,
            string,
          ][]
        ).map(([key, label]) => (
          <label key={key} className="text-xs">
            {label}
            {key === 'document_type' ? (
              <select
                disabled={locked || saving}
                value={data[key] ?? ''}
                onChange={(e) => setData((current) => ({ ...current, [key]: e.target.value }))}
                className="border-border bg-background mt-1 block w-full rounded border px-2 py-1.5"
              >
                <option value="">SELECCIONAR</option>
                {['DNI', 'CARNE DE EXTRANJERIA', 'PASAPORTE', 'OTRO'].map(
                  (t) => (
                    <option key={t}>{t}</option>
                  )
                )}
              </select>
            ) : (
              <input
                disabled={locked || saving}
                value={data[key] ?? ''}
                type={
                  key.endsWith('_date')
                    ? 'date'
                    : key === 'email'
                      ? 'email'
                      : 'text'
                }
                onChange={(e) => setData((current) => ({ ...current, [key]: e.target.value }))}
                className="border-border bg-background mt-1 block w-full rounded border px-2 py-1.5 text-sm"
              />
            )}
          </label>
        ))}
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">
          CUOTAS DE LA OFERTA RECIBIDA
        </legend>
        <p className="text-muted-foreground text-xs">
          Comprueba la promoción ofrecida en el chat. No se elige
          automáticamente por el precio del voucher.
        </p>
        <div className="grid grid-cols-3 gap-2 md:grid-cols-6">
          {Array.from({ length: 6 }, (_, i) => (
            <label key={i} className="text-xs">
              MES {i + 1}
              <input
                disabled={locked || saving}
                type="number"
                min="0"
                step="0.01"
                value={data.prices?.[i] ?? ''}
                onChange={(e) => {
                  const value = e.target.value;
                  setData((current) => {
                  const prices = [...(current.prices ?? Array(6).fill(0))];
                  prices[i] = Number(value);
                  return { ...current, prices };
                  });
                }}
                className="border-border bg-background mt-1 w-full rounded border px-2 py-1.5"
              />
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">FOTOS DEL DOCUMENTO</legend>
        {!!data.declaration_message_ids?.length && <p className="rounded border border-amber-500/40 p-2.5 text-xs text-amber-600">No hay foto del documento. Se está usando como respaldo el nombre, documento y correo escritos por el estudiante en este chat.</p>}
        <p className="text-muted-foreground text-xs">
          Selecciona las fotos del documento de identidad. La lectura completa
          solamente campos vacíos; compara siempre con los datos escritos.
        </p>
        {images.filter(
          (image) => image.image_analysis?.category !== 'payment_receipt'
        ).length === 0 ? (
          <p className="text-xs">
            No hay fotos de identidad disponibles todavía.
          </p>
        ) : (
          images
            .filter(
              (image) => image.image_analysis?.category !== 'payment_receipt'
            )
            .map((image) => (
              <div key={image.id} className="border-border rounded border p-3">
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    disabled={
                      locked ||
                      saving ||
                      (!data.identity_message_ids?.includes(image.id) &&
                        (data.identity_message_ids?.length ?? 0) >= 4)
                    }
                    checked={
                      data.identity_message_ids?.includes(image.id) ?? false
                    }
                    onChange={(e) =>
                      setData((current) => ({
                        ...current,
                        identity_confirmed: false,
                        identity_message_ids: e.target.checked
                          ? [...(current.identity_message_ids ?? []), image.id]
                          : (current.identity_message_ids ?? []).filter(
                              (id) => id !== image.id
                            ),
                      }))
                    }
                  />
                  <span>
                    {image.image_analysis?.summary || 'IMAGEN SIN LECTURA'}{' '}
                    {image.media_url && (
                      <a
                        href={image.media_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline"
                      >
                        Abrir foto
                      </a>
                    )}
                  </span>
                </label>
                <label className="mt-2 flex gap-2 text-xs"><input type="checkbox" disabled={locked||saving||(!data.guardian_message_ids?.includes(image.id)&&(data.guardian_message_ids?.length??0)>=4)} checked={data.guardian_message_ids?.includes(image.id)??false} onChange={e=>setData({...data,guardian_message_ids:e.target.checked?[...(data.guardian_message_ids??[]),image.id]:(data.guardian_message_ids??[]).filter(id=>id!==image.id)})}/>DOCUMENTO DEL TUTOR O PADRES (SI ES MENOR DE EDAD)</label>
                {image.image_analysis?.category === 'identity_document' && (
                  <Button
                    className="mt-2"
                    variant="outline"
                    disabled={locked || saving}
                    onClick={() =>
                      setData((current) => suggestIdentityData(current, image.image_analysis))
                    }
                  >
                    Completar campos vacíos con la lectura
                  </Button>
                )}
              </div>
            ))
        )}
      </fieldset>
      <div className="rounded-md border border-border p-2.5 text-xs sm:p-3">
        <label htmlFor={identityCheckId} className="flex min-h-8 cursor-pointer items-center gap-2">
          <input
            id={identityCheckId}
            type="checkbox"
            className="size-4 shrink-0 accent-primary"
            disabled={locked || saving || (!hasIdentityPhotos && !hasWrittenEvidence)}
            checked={data.identity_confirmed ?? false}
            onChange={(e) => setData((current) => ({ ...current, identity_confirmed: e.target.checked }))}
          />
          {hasIdentityPhotos
            ? 'Revisé que el nombre y número coincidan con la foto seleccionada.'
            : hasWrittenEvidence
              ? 'Revisé que el nombre y número coincidan con los datos escritos que dejó el estudiante.'
              : 'Confirmar identidad (requiere seleccionar una foto del documento arriba).'}
        </label>
        {!hasIdentityPhotos && !hasWrittenEvidence && (
          <p className="mt-1 text-muted-foreground">Este control no compara por sí solo. Si no hay foto, solo se acepta el respaldo escrito completo que el sistema detecte en el chat.</p>
        )}
      </div>
      <label className="flex gap-2 text-sm">
        <input
          type="checkbox"
          disabled={locked || saving}
          checked={data.offer_confirmed ?? false}
          onChange={(e) =>
            setData((current) => ({ ...current, offer_confirmed: e.target.checked }))
          }
        />
        Confirmé en la conversación la promoción y sus seis cuotas
      </label>
      {draft.status !== 'collecting' && issues.length > 0 && (
        <div className="rounded border border-amber-500/40 p-3">
          <h3 className="text-sm font-semibold">PENDIENTES PARA REGISTRAR</h3>
          <ul className="mt-2 list-disc pl-5 text-xs">
            {issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      )}
      {!locked && (
        <div className="flex flex-wrap gap-3">
          <Button disabled={saving} onClick={save}>
            Guardar datos
          </Button>
          <Button
            variant="outline"
            disabled={saving || dirty || issues.length > 0}
            onClick={enqueue}
          >
            Enviar a cola de registro
          </Button>
          {dirty && (
            <p className="text-muted-foreground text-xs">
              Guarda los cambios antes de enviar la ficha.
            </p>
          )}
        </div>
      )}
      {draft.student_folder_url && (
        <a
          href={draft.student_folder_url}
          target="_blank"
          rel="noopener noreferrer"
          className="block underline"
        >
          Carpeta del estudiante
        </a>
      )}
    </article>
  );
}
function EnrollmentsPageContent() {
  const params = useSearchParams();
  const review = params.get('review_id');
  const [drafts, setDrafts] = useState<EnrollmentDraft[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [search,setSearch]=useState('');
  const [showHistory,setShowHistory]=useState(false);
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/enrollments${review ? `?review_id=${encodeURIComponent(review)}` : ''}`,
        { cache: 'no-store' }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setDrafts(json.drafts);
      if(review&&json.drafts.length===1)setSelectedId(json.drafts[0].id);
      setCanEdit(json.canEdit === true);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar');
    } finally {
      setLoading(false);
    }
  }, [review]);
  useEffect(() => {
    void load();
  }, [load]);
  const selected=drafts.find(draft=>draft.id===selectedId);
  const statusLabel=(draft:EnrollmentDraft)=>draft.status==='registered'?'Registrado':draft.status==='processing'?'En proceso':draft.status==='ready'?'En cola':draft.status==='error'?'Revisar error':draft.payment_status==='pending'?'Validar pago':'Completar datos';
  const visibleDrafts=drafts.filter(draft=>(showHistory?draft.status==='registered':draft.status!=='registered')&&`${draft.data.full_name||''} ${draft.data.course||''} ${draft.data.document_number||''} ${draft.registered_number||''}`.toLocaleLowerCase('es').includes(search.toLocaleLowerCase('es')));
  return (
    <section className="space-y-5">
      <h1 className="text-2xl font-bold">REGISTRO DE MATRICULAS</h1>
      {canEdit&&<ManualEnrollment onCreated={()=>void load()}/>}
      <div className="space-y-4 rounded-xl border border-border bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">Seguimiento de matrículas</h2><p className="mt-1 max-w-2xl text-sm text-muted-foreground">Aquí revisas los datos, la validación del pago y la entrega de documentos. Los registrados se conservan en el historial; el cuadro de inicios organiza las clases.</p></div><Button variant="outline" onClick={load} disabled={loading}>Actualizar</Button></div>
        <div className="flex flex-wrap items-center gap-2" aria-label="Filtrar matrículas"><Button variant={!showHistory?'default':'outline'} onClick={()=>setShowHistory(false)}>Pendientes ({drafts.filter(d=>d.status!=='registered').length})</Button><Button variant={showHistory?'default':'outline'} onClick={()=>setShowHistory(true)}>Historial ({drafts.filter(d=>d.status==='registered').length})</Button></div>
        <input aria-label="Buscar matrículas" placeholder="Buscar estudiante, DNI, curso o número de matrícula" value={search} onChange={event=>setSearch(event.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"/>
      {error ? (
        <p role="alert" className="text-red-400">
          {error}
        </p>
      ) : loading ? (
        <p>Cargando…</p>
      ) : visibleDrafts.length ? (
        <div className="max-h-[60dvh] overflow-y-auto rounded-lg border border-border">
          <div className="sticky top-0 z-10 hidden grid-cols-[2fr_2fr_1fr_1fr] gap-3 border-b border-border bg-muted px-4 py-3 text-xs font-semibold md:grid"><span>ESTUDIANTE</span><span>CURSO</span><span>ESTADO</span><span>DETALLE</span></div>
          {visibleDrafts.map(draft=><div key={draft.id} className="grid gap-3 border-b border-border p-4 last:border-b-0 md:grid-cols-[2fr_2fr_1fr_1fr] md:items-center">
            <div className="min-w-0"><p className="break-words font-medium">{draft.data.full_name||'Estudiante sin datos completos'}</p><p className="text-xs text-muted-foreground">{draft.registered_number?`Matrícula ${draft.registered_number}`:'Sin número asignado'}{draft.data.document_number?` · Doc. ${draft.data.document_number}`:''}</p></div>
            <div className="min-w-0 text-sm"><p className="break-words">{draft.data.course||'Curso por confirmar'}</p><p className="text-xs text-muted-foreground">{draft.data.start_date?`Inicio: ${draft.data.start_date}`:'Inicio por confirmar'}</p></div>
            <span className={`w-fit rounded-md border px-2 py-1 text-xs ${draft.status==='registered'?'border-emerald-500/30 text-emerald-600':draft.status==='error'?'border-red-500/30 text-red-500':'border-border text-muted-foreground'}`}>{statusLabel(draft)}</span>
            <Button variant="outline" className="w-full" onClick={()=>setSelectedId(draft.id)}>Ver ficha</Button>
          </div>)}
        </div>
      ) : (
        <p className="py-6 text-center text-sm text-muted-foreground">{search?'No hay matrículas que coincidan con la búsqueda.':showHistory?'Todavía no hay matrículas registradas.':'No hay matrículas pendientes.'}</p>
      )}
      </div>
      <Dialog open={!!selected} onOpenChange={value=>{if(!value)setSelectedId(null);}}><DialogContent className="max-h-[92dvh] overflow-y-auto p-3 sm:max-w-5xl sm:p-5"><DialogHeader className="pr-10"><DialogTitle>Ficha de matrícula</DialogTitle><DialogDescription>Revisa los datos y documentos del estudiante seleccionado.</DialogDescription></DialogHeader>{selected&&<EnrollmentEditor key={selected.id} initial={selected} canEdit={canEdit}/>}</DialogContent></Dialog>
    </section>
  );
}
export default function EnrollmentsPage() {
  return (
    <Suspense fallback={<p>Cargando matrículas…</p>}>
      <EnrollmentsPageContent />
    </Suspense>
  );
}
