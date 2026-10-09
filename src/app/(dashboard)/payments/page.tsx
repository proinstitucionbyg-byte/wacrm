'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { PaymentDecision } from '@/components/payments/payment-review-controls';
import { PAYMENT_LABELS, PAYMENT_STATUSES, type PaymentReview } from '@/lib/payments/review';

export default function PaymentsPage() {
  const [status, setStatus] = useState('pending');
  const [offset, setOffset] = useState(0);
  const [reviews, setReviews] = useState<PaymentReview[]>([]);
  const [total, setTotal] = useState(0);
  const [canReview, setCanReview] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/payments?status=${status}&offset=${offset}`, { cache: 'no-store' });
      const data = await res.json(); if (!res.ok) throw new Error(data.error ?? 'No se pudo cargar la bandeja');
      setReviews(data.reviews); setTotal(data.total); setCanReview(data.canReview); setError('');
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo cargar'); }
    finally { setLoading(false); }
  }, [status, offset]);
  useEffect(() => { void load(); }, [load]);
  return <section className="space-y-5">
    <h1 className="text-2xl font-bold">VALIDACION DE PAGOS</h1>
    <p className="text-sm text-muted-foreground">Comprobantes recibidos y derivados. La lectura automática no aprueba un pago; una persona autorizada revisa y decide.</p>
    <div className="flex flex-wrap items-center gap-3">
      <label>Estado <select value={status} onChange={(event) => { setStatus(event.target.value); setOffset(0); }} className="ml-2 rounded-md border border-border bg-background p-2">
        {PAYMENT_STATUSES.map((value) => <option key={value} value={value}>{PAYMENT_LABELS[value]}</option>)}<option value="all">TODOS</option>
      </select></label>
      <Button variant="outline" onClick={load} disabled={loading}>Actualizar</Button>
      <span className="text-sm">{total} comprobantes</span>
    </div>
    {error ? <p role="alert" className="text-red-400">{error}</p> : loading ? <p>Cargando comprobantes…</p> : reviews.length === 0 ? <p>No hay comprobantes en este estado.</p> : <div className="grid gap-4 xl:grid-cols-2">
      {reviews.map((review) => <article key={review.id} className="rounded-lg border border-border bg-card p-5">
        <h2 className="text-lg font-semibold">{review.contact?.name || review.contact?.phone || 'Contacto sin nombre'}</h2>
        <p className="text-xs text-muted-foreground">Recibido: {new Date(review.created_at).toLocaleString('es-PE', { timeZone: 'America/Lima' })}</p>
        {review.media_url && <a href={review.media_url} target="_blank" rel="noopener noreferrer" className="my-3 block text-sm underline">Abrir imagen original</a>}
        <p className="my-2 text-sm">{review.evidence.summary || 'Revisión manual de imagen'}</p>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          {[['Monto', review.evidence.fields?.amount], ['Moneda', review.evidence.fields?.currency], ['Fecha del comprobante', review.evidence.fields?.date], ['Operación', review.evidence.fields?.transaction_reference], ['Destinatario leído', review.evidence.fields?.recipient]].map(([label, value]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd>{value || 'NO LEGIBLE'}</dd></div>)}
        </dl>
        <PaymentDecision key={`${review.id}:${review.version}`} review={review} canReview={canReview} onChanged={load} />
        {review.conversation_id && <Link href={`/inbox?c=${review.conversation_id}`} className="mt-3 block text-sm underline">Abrir conversación</Link>}
      </article>)}
    </div>}
    <div className="flex gap-2">
      <Button variant="outline" disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0,offset-50))}>Anterior</Button>
      <Button variant="outline" disabled={offset+50 >= total || loading} onClick={() => setOffset(offset+50)}>Siguiente</Button>
    </div>
  </section>;
}
