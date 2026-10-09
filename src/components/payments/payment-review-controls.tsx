'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { PAYMENT_LABELS, type PaymentReview, type PaymentStatus } from '@/lib/payments/review';

export function PaymentDecision({ review, canReview, onChanged }: { review: PaymentReview; canReview: boolean; onChanged: () => void }) {
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  async function decide(status: Exclude<PaymentStatus, 'pending'>) {
    if (status !== 'validated' && !note.trim()) { toast.error('Escribe el motivo de rechazo u observación.'); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/payments/${review.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status, note, version: review.version }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'No se pudo guardar la decisión');
      toast.success('Decisión guardada.'); onChanged();
    } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo guardar'); }
    finally { setSaving(false); }
  }
  return <div className="mt-3 space-y-2">
    <p className="font-semibold">{PAYMENT_LABELS[review.status]}</p>
    <p className="text-xs text-muted-foreground">Origen: {review.origin} · {review.source_area}{review.source_adviser ? ` · ${review.source_adviser}` : ''}</p>
    {review.note && <p className="whitespace-pre-wrap text-sm">Motivo: {review.note}</p>}
    {review.reviewed_at && <p className="text-xs text-muted-foreground">Decisión del CEO: {new Date(review.reviewed_at).toLocaleString('es-PE', { timeZone: 'America/Lima' })}</p>}
    {review.status === 'validated' && <Link href={`/enrollments?review_id=${review.id}`} className="block text-sm underline">Continuar al registro del estudiante</Link>}
    {canReview && review.status !== 'validated' && <>
      <label className="block text-xs">Observación de tu revisión
        <textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} disabled={saving} className="mt-1 min-h-20 w-full rounded-md border border-border bg-background p-2 text-sm" />
      </label>
      <p className="text-xs text-muted-foreground">Valida únicamente después de comprobar el abono en tus registros. Esto no genera ni envía documentos todavía.</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={saving} onClick={() => decide('validated')}>✓ VALIDADO</Button>
        <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => decide('rejected')}>NO VALIDADO</Button>
        <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => decide('observation')}>EN OBSERVACION</Button>
      </div>
    </>}
    {!canReview && <p className="text-xs text-muted-foreground">La aprobación corresponde al CEO.</p>}
  </div>;
}

export function PaymentReviewControls({ messageId }: { messageId: string }) {
  const [review, setReview] = useState<PaymentReview | null>(null);
  const [canReview, setCanReview] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [referring, setReferring] = useState(false);
  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/payments?message_id=${messageId}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('No se pudo consultar la revisión');
      const data = await res.json(); setReview(data.reviews[0] ?? null); setCanReview(data.canReview); setFailed(false);
    } catch { setFailed(true); } finally { setLoading(false); }
  }, [messageId]);
  useEffect(() => { void load(); }, [load]);
  async function refer() {
    setReferring(true);
    try {
      const res = await fetch('/api/payments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message_id: messageId }) });
      const data = await res.json(); if (!res.ok) throw new Error(data.error);
      toast.success('Comprobante enviado a revisión.'); await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo derivar'); }
    finally { setReferring(false); }
  }
  if (loading) return <p className="mt-2 text-xs text-muted-foreground">Consultando revisión…</p>;
  if (failed) return <Button size="sm" variant="outline" onClick={load}>Reintentar revisión de pago</Button>;
  return <div className="mt-2 max-w-sm rounded-md border border-border p-3" onClick={(event) => event.stopPropagation()}>
    {review ? <PaymentDecision key={`${review.id}:${review.version}`} review={review} canReview={canReview} onChanged={load} /> : <Button size="sm" variant="outline" disabled={referring} onClick={refer}>Enviar comprobante a Finanzas</Button>}
    <Link href="/payments" className="mt-2 block text-xs underline">Abrir bandeja de pagos</Link>
  </div>;
}
