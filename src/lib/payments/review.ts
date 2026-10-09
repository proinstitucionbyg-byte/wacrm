export const PAYMENT_STATUSES = ['pending', 'validated', 'rejected', 'observation'] as const;
export type PaymentStatus = typeof PAYMENT_STATUSES[number];
export const PAYMENT_LABELS: Record<PaymentStatus, string> = {
  pending: 'PENDIENTE DE VALIDACION', validated: 'PAGO VALIDADO',
  rejected: 'PAGO NO VALIDADO', observation: 'PAGO EN OBSERVACION',
};
export function isPaymentStatus(value: unknown): value is PaymentStatus {
  return typeof value === 'string' && PAYMENT_STATUSES.includes(value as PaymentStatus);
}
export function parsePaymentDecision(body: unknown): { status: Exclude<PaymentStatus, 'pending'>; note: string; version: number } | null {
  if (!body || typeof body !== 'object') return null;
  const raw = body as Record<string, unknown>;
  if (!isPaymentStatus(raw.status) || raw.status === 'pending' ||
      !Number.isSafeInteger(raw.version) || (raw.version as number) < 1 ||
      typeof raw.note !== 'string' || raw.note.length > 2000) return null;
  const note = raw.note.trim();
  if (raw.status !== 'validated' && !note) return null;
  return { status: raw.status, note, version: raw.version as number };
}
export interface PaymentReview {
  id: string; message_id: string | null; conversation_id: string | null;
  contact_id: string | null; status: PaymentStatus; source_area: string;
  source_adviser: string | null; origin: string; note: string | null;
  version: number; created_at: string; reviewed_at: string | null;
  reviewed_by: string | null; media_url: string | null;
  evidence: { summary?: string; fields?: Record<string, string | null>; observations?: string[] };
  contact?: { name: string | null; phone: string | null } | null;
}
