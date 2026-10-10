export const ENROLLMENT_FIELDS = {
  full_name: 'NOMBRE COMPLETO',
  document_type: 'TIPO DE DOCUMENTO',
  document_number: 'NUMERO DE DOCUMENTO',
  birth_date: 'FECHA DE NACIMIENTO',
  phone1: 'CELULAR 1',
  phone2: 'CELULAR 2',
  address: 'DIRECCION',
  department: 'DEPARTAMENTO',
  district: 'DISTRITO',
  email: 'CORREO ELECTRONICO',
  course: 'CURSO',
  start_date: 'INICIO OFICIAL DEL MODULO',
  promotion_id: 'PROMOCION OFRECIDA',
  payment_date: 'FECHA DEL PAGO',
  amount: 'MONTO PAGADO',
  payment_method: 'METODO DE PAGO',
} as const;
export type EnrollmentData = Partial<
  Record<keyof typeof ENROLLMENT_FIELDS, string>
> & {
  identity_confirmed?: boolean;
  offer_confirmed?: boolean;
  identity_message_ids?: string[];
  declaration_message_ids?: string[];
  guardian_message_ids?: string[];
  prices?: number[];
};
export interface EnrollmentDraft {
  id: string;
  review_id: string;
  conversation_id: string | null;
  status: 'collecting' | 'ready' | 'processing' | 'registered' | 'error';
  version: number;
  data: EnrollmentData;
  registered_number: string | null;
  student_folder_url: string | null;
  error: string | null;
  created_at: string;
}
/** OCR is a suggestion. Never replace written data or confirm identity from a photo alone. */
export function suggestIdentityData(
  data: EnrollmentData,
  analysis: { category?: string; fields?: Record<string, unknown> } | null
): EnrollmentData {
  if (analysis?.category !== 'identity_document') return data;
  const next = { ...data, identity_confirmed: false };
  for (const key of [
    'full_name',
    'document_number',
    'birth_date',
    'address',
    'department',
    'district',
  ] as const) {
    const value = analysis.fields?.[key];
    if (!next[key] && typeof value === 'string' && value.trim())
      next[key] = upper(value);
  }
  return next;
}
const text = (value: string) => value.trim().replace(/\s+/g, ' ');
const upper = (value: string) => text(value).toUpperCase();
export function parseEnrollmentData(raw: unknown): EnrollmentData | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;
  const out: EnrollmentData = {};
  for (const key of Object.keys(
    ENROLLMENT_FIELDS
  ) as (keyof typeof ENROLLMENT_FIELDS)[]) {
    if (input[key] !== undefined && typeof input[key] !== 'string') return null;
    const value = text(String(input[key] ?? ''));
    if (value.length > 500) return null;
    out[key] = ['email'].includes(key)
      ? value.toLowerCase()
      : ['phone1', 'phone2', 'document_number'].includes(key)
        ? upper(value).replace(/[\s()-]/g, '')
        : upper(value);
  }
  for (const key of ['identity_confirmed', 'offer_confirmed'] as const) {
    if (input[key] !== undefined && typeof input[key] !== 'boolean')
      return null;
    out[key] = input[key] === true;
  }
  if (
    input.identity_message_ids !== undefined &&
    (!Array.isArray(input.identity_message_ids) ||
      input.identity_message_ids.length > 4 ||
      input.identity_message_ids.some(
        (id) => typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)
      ))
  )
    return null;
  out.identity_message_ids = [
    ...new Set((input.identity_message_ids ?? []) as string[]),
  ];
  for (const field of ['declaration_message_ids', 'guardian_message_ids'] as const) {
    const ids = input[field] ?? [];
    if (!Array.isArray(ids) || ids.length > 4 || ids.some(id => typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id))) return null;
    out[field] = [...new Set(ids)] as string[];
  }
  if (
    input.prices !== undefined &&
    (!Array.isArray(input.prices) ||
      input.prices.length !== 6 ||
      input.prices.some(
        (n) =>
          typeof n !== 'number' ||
          !Number.isFinite(n) ||
          n < 0 ||
          Math.abs(n * 100 - Math.round(n * 100)) > 0.00001
      ))
  )
    return null;
  out.prices = input.prices as number[] | undefined;
  return out;
}
export function isMinor(birthDate: string | undefined, today = new Date()): boolean {
  if (!birthDate || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate) || Number.isNaN(Date.parse(birthDate))) return false;
  const localDay = today.toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
  const eighteenth = `${Number(birthDate.slice(0, 4)) + 18}${birthDate.slice(4)}`;
  return birthDate <= localDay && localDay < eighteenth;
}
export function enrollmentIssues(data: EnrollmentData): string[] {
  const issues: string[] = [];
  for (const key of [
    'full_name',
    'document_type',
    'document_number',
    'phone1',
    'email',
    'course',
    'start_date',
    'promotion_id',
    'payment_date',
    'amount',
    'payment_method',
  ] as const)
    if (!data[key]) issues.push(`FALTA ${ENROLLMENT_FIELDS[key]}`);
  if (
    data.document_type &&
    !['DNI', 'CARNE DE EXTRANJERIA', 'PASAPORTE', 'OTRO'].includes(
      data.document_type
    )
  )
    issues.push('REVISAR TIPO DE DOCUMENTO');
  if (
    data.document_number &&
    (data.document_type === 'DNI'
      ? !/^\d{8}$/.test(data.document_number)
      : !/^[A-Z0-9]+$/.test(data.document_number))
  )
    issues.push('REVISAR NUMERO DE DOCUMENTO');
  for (const key of ['phone1', 'phone2'] as const)
    if (data[key] && !/^\+?\d{7,15}$/.test(data[key]))
      issues.push(`REVISAR ${ENROLLMENT_FIELDS[key]}`);
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email))
    issues.push('REVISAR CORREO');
  for (const key of ['start_date', 'payment_date', 'birth_date'] as const) {
    const value = data[key];
    if (
      value &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        Number.isNaN(Date.parse(value)) ||
        new Date(value).toISOString().slice(0, 10) !== value)
    )
      issues.push(`REVISAR ${ENROLLMENT_FIELDS[key]}`);
  }
  if ((!data.identity_confirmed || !data.identity_message_ids?.length) && !data.declaration_message_ids?.length)
    issues.push('COMPARAR NOMBRE Y DOCUMENTO CON SUS FOTOS');
  if (isMinor(data.birth_date) && !data.guardian_message_ids?.length)
    issues.push('SOLICITAR DNI DEL TUTOR O PADRES');
  if (!data.offer_confirmed || data.prices?.length !== 6)
    issues.push('CONFIRMAR LA OFERTA DE SEIS CUOTAS QUE RECIBIO EL ESTUDIANTE');
  if (
    data.amount &&
    (!/^\d+(\.\d{1,2})?$/.test(data.amount) || Number(data.amount) <= 0)
  )
    issues.push('REVISAR MONTO');
  // CEO-approved exception for this first-month promotion only; retain actual paid amount.
  const paid = Number(data.amount);
  const acceptedFirstMonth = data.prices?.[0] === 19.9 && paid >= 19 && paid <= 21;
  if (data.prices?.length === 6 && paid !== data.prices[0] && !acceptedFirstMonth)
    issues.push('PAGO PARCIAL O DISTINTO DE LA OFERTA: REVISAR');
  return [...new Set(issues)];
}
