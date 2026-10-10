export const PAYMENT_STATUSES = ['pending', 'validated', 'rejected', 'observation'] as const;
export type PaymentStatus = typeof PAYMENT_STATUSES[number];
/** Age is a warning, never an expiry or an automatic decision. */
export function oldReceiptDate(raw: string | null | undefined, today = new Date()): boolean {
  if (!raw) return false;
  const text=raw.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase();
  let iso=/^\d{4}-\d{2}-\d{2}/.test(text)?text.slice(0,10):'';
  const numeric=text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  const spanish=text.match(/^(\d{1,2})\s+(ENE|FEB|MAR|ABR|MAY|JUN|JUL|AGO|SEP|OCT|NOV|DIC)[A-Z]*\.?\s+(\d{4})/);
  if(numeric)iso=`${numeric[3]}-${numeric[2].padStart(2,'0')}-${numeric[1].padStart(2,'0')}`;
  if(spanish)iso=`${spanish[3]}-${String(['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'].indexOf(spanish[2])+1).padStart(2,'0')}-${spanish[1].padStart(2,'0')}`;
  const parsed=new Date(iso+'T00:00:00-05:00');
  return Number.isFinite(parsed.getTime())&&parsed.toLocaleDateString('en-CA',{timeZone:'America/Lima'})===iso&&today.getTime()-parsed.getTime()>=7*86400000;
}
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
