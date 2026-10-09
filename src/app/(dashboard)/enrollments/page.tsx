'use client';
import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  ENROLLMENT_FIELDS,
  suggestIdentityData,
  type EnrollmentData,
  type EnrollmentDraft,
} from '@/lib/matriculas/enrollment';

type Evidence = {
  id: string;
  media_url: string | null;
  image_analysis: {
    category?: string;
    summary?: string;
    fields?: Record<string, string | null>;
  } | null;
};
function EnrollmentEditor({ initial }: { initial: EnrollmentDraft }) {
  const [draft, setDraft] = useState(initial);
  const [data, setData] = useState<EnrollmentData>(initial.data);
  const [images, setImages] = useState<Evidence[]>([]);
  const [issues, setIssues] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    fetch(`/api/enrollments/${initial.id}`, { cache: 'no-store' })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error);
        setImages(json.images);
        setIssues(json.issues);
      })
      .catch((err) => setError(err.message));
  }, [initial.id]);
  const locked = ['ready', 'processing', 'registered'].includes(draft.status);
  const dirty = JSON.stringify(data) !== JSON.stringify(draft.data);
  async function enqueue() {
    setSaving(true);
    try {
      const res = await fetch(`/api/enrollments/${draft.id}/submit`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: draft.version }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setDraft(json.draft); setError('');
      toast.success('Ficha en cola de registro. Todavía no confirma documentos enviados.');
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo enviar'); }
    finally { setSaving(false); }
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
      setIssues(json.issues);
      setError('');
      toast.success('Datos guardados. El pago conserva su validación.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  }
  return (
    <article className="border-border bg-card space-y-4 rounded-lg border p-5">
      <h2 className="font-semibold">
        {data.full_name || 'MATRICULA CON DATOS PENDIENTES'}
      </h2>
      <p className="text-muted-foreground text-sm">
        PAGO VALIDADO ·{' '}
        {draft.status === 'registered'
          ? `REGISTRO ${draft.registered_number}`
          : draft.status === 'processing'
            ? 'REGISTRANDO'
            : draft.status === 'ready' ? 'EN COLA PARA GOOGLE' : 'COMPLETAR DATOS'}
      </p>
      {draft.error && <p role="alert" className="text-red-400">REVISAR REGISTRO: {draft.error}</p>}
      {draft.status === 'ready' && <p className="text-sm text-muted-foreground">El programa de Google procesará esta ficha cuando la conexión esté instalada y activa. Este estado todavía no acredita registro ni entrega de PDF.</p>}
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
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
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
                onChange={(e) => setData({ ...data, [key]: e.target.value })}
                className="border-border bg-background mt-1 block w-full rounded border p-2"
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
                onChange={(e) => setData({ ...data, [key]: e.target.value })}
                className="border-border bg-background mt-1 block w-full rounded border p-2 text-sm"
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
                  const prices = [...(data.prices ?? Array(6).fill(0))];
                  prices[i] = Number(e.target.value);
                  setData({ ...data, prices });
                }}
                className="border-border bg-background mt-1 w-full rounded border p-2"
              />
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">FOTOS DEL DOCUMENTO</legend>
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
                      setData({
                        ...data,
                        identity_confirmed: false,
                        identity_message_ids: e.target.checked
                          ? [...(data.identity_message_ids ?? []), image.id]
                          : (data.identity_message_ids ?? []).filter(
                              (id) => id !== image.id
                            ),
                      })
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
                {image.image_analysis?.category === 'identity_document' && (
                  <Button
                    className="mt-2"
                    variant="outline"
                    disabled={locked || saving}
                    onClick={() =>
                      setData(suggestIdentityData(data, image.image_analysis))
                    }
                  >
                    Completar campos vacíos con la lectura
                  </Button>
                )}
              </div>
            ))
        )}
      </fieldset>
      <label className="flex gap-2 text-sm">
        <input
          type="checkbox"
          disabled={locked || saving}
          checked={data.identity_confirmed ?? false}
          onChange={(e) =>
            setData({ ...data, identity_confirmed: e.target.checked })
          }
        />
        Comparé nombre y número de documento con las fotos y los datos escritos
      </label>
      <label className="flex gap-2 text-sm">
        <input
          type="checkbox"
          disabled={locked || saving}
          checked={data.offer_confirmed ?? false}
          onChange={(e) =>
            setData({ ...data, offer_confirmed: e.target.checked })
          }
        />
        Confirmé en la conversación la promoción y sus seis cuotas
      </label>
      {issues.length > 0 && (
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
          <Button disabled={saving} onClick={save}>Guardar datos</Button>
          <Button variant="outline" disabled={saving || dirty || issues.length > 0} onClick={enqueue}>Enviar a cola de registro</Button>
          {dirty && <p className="text-xs text-muted-foreground">Guarda los cambios antes de enviar la ficha.</p>}
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
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
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
  return (
    <section className="space-y-5">
      <h1 className="text-2xl font-bold">REGISTRO DE MATRICULAS</h1>
      <p className="text-muted-foreground text-sm">
        Cada ficha corresponde a un pago validado por el CEO. Los faltantes no
        eliminan la aprobación.
      </p>
      <Button variant="outline" onClick={load} disabled={loading}>
        Actualizar
      </Button>
      {error ? (
        <p role="alert" className="text-red-400">
          {error}
        </p>
      ) : loading ? (
        <p>Cargando…</p>
      ) : drafts.length ? (
        drafts.map((draft) => (
          <EnrollmentEditor
            key={`${draft.id}:${draft.version}`}
            initial={draft}
          />
        ))
      ) : (
        <p>No hay pagos validados para registrar.</p>
      )}
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
