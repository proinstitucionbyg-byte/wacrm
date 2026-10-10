import { parseEnrollmentData, type EnrollmentData } from './enrollment';
import { isGuardianMessage } from './identity-evidence';

export interface IntakeMessage {
  id: string;
  content_text: string | null;
  image_analysis?: {
    category?: string;
    fields?: Record<string, unknown>;
  } | null;
}
const clean = (value: string) => value.trim().replace(/\s+/g, ' ');
const key = (value: string) =>
  clean(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
const courses = [
  [/\bNUTRICION(?: Y DIETETICA)?\b/, 'NUTRICION Y DIETETICA'],
  [/\b(?:AUXILIAR DE )?FARMACIA\b/, 'AUXILIAR DE FARMACIA'],
  [/\bRECURSOS HUMANOS\b/, 'RECURSOS HUMANOS'],
  [/\bASISTENTE ADMINISTRATIVO\b/, 'ASISTENTE ADMINISTRATIVO'],
  [/\b(?:AUXILIAR DE )?EDUCACION INICIAL\b/, 'AUXILIAR DE EDUCACION INICIAL'],
] as const;

/** Deterministic extraction, no AI call. Photos and chat text never approve payment/identity/offer. */
export function collectEnrollmentData(
  data: EnrollmentData,
  messages: IntakeMessage[]
): EnrollmentData {
  const candidates = new Map<keyof EnrollmentData, Set<string>>();
  const add = (field: keyof EnrollmentData, raw: unknown) => {
    if (typeof raw !== 'string' || !raw.trim() || raw.length > 500) return;
    const parsed = parseEnrollmentData({ [field]: raw });
    const value = parsed?.[field];
    if (typeof value !== 'string' || !value) return;
    const values = candidates.get(field) ?? new Set<string>();
    values.add(value);
    candidates.set(field, values);
  };
  const photoIds: string[] = [];
  const guardianIds: string[] = [];
  for (const message of messages) {
    if (isGuardianMessage(message)) {
      if (message.image_analysis?.category === 'identity_document') guardianIds.push(message.id);
      continue;
    }
    // Some captions arrive with literal backslash-n from the sender.
    const text = (message.content_text ?? '').replace(/\\n/g, '\n');
    for (const line of text.split(/\r?\n/)) {
      const labelled = line.match(
        /^\s*(nombre(?: completo)?|nombres(?: y apellidos)?|correo(?: electronico)?|email|celular(?:\s*[12])?|telefono(?:\s*[12])?|dni|carn[eé] de extranjer[ií]a|pasaporte|fecha de nacimiento|direccion|dirección|departamento|distrito|curso|promocion)\s*:\s*(.+)$/i
      );
      if (!labelled) continue;
      const label = key(labelled[1]);
      const value = labelled[2];
      if (/^NOMBRE/.test(label)) add('full_name', value);
      else if (/^(CORREO|EMAIL)/.test(label)) add('email', value);
      else if (/^(CELULAR|TELEFONO)/.test(label)) {
        const phone = value.replace(/[\s()-]/g, '');
        // Unnumbered supplied phone is additional to the WhatsApp contact number.
        const field = /1$/.test(label) ? 'phone1' : 'phone2';
        if (
          /^\+?\d{7,15}$/.test(phone) &&
          phone.replace(/^\+/, '') !== data.phone1?.replace(/^\+/, '')
        )
          add(field, phone);
      } else if (['DNI','CARNE DE EXTRANJERIA','PASAPORTE'].includes(label) && /^[A-Z0-9\s-]+$/i.test(value.trim())) {
        add('document_type', label);
        add('document_number', value);
      } else if (label === 'FECHA DE NACIMIENTO') {
        const date = value.trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
        add('birth_date', date ? `${date[3]}-${date[2].padStart(2,'0')}-${date[1].padStart(2,'0')}` : value);
      } else if (['DIRECCION','DEPARTAMENTO','DISTRITO'].includes(label)) {
        add(({DIRECCION:'address', DEPARTAMENTO:'department', DISTRITO:'district'} as const)[label as 'DIRECCION'|'DEPARTAMENTO'|'DISTRITO'],value);
      } else if (label === 'PROMOCION') add('promotion_id', value);
    }
    const normalized = key(text);
    // A question or a list of courses is not an enrollment decision.
    if (
      !/\bNO\b/.test(normalized) &&
      /\bCURSO\s*:|\b(?:QUIERO|ELIJO|ESCOJO|MATRICULAR|INSCRIB|ES EL CURSO|SUPER PROMO)/.test(
        normalized
      )
    ) {
      const matches = courses.filter(([pattern]) => pattern.test(normalized));
      if (matches.length === 1) add('course', matches[0][1]);
    }
    const promo = normalized.match(
      /\bSUPER PROMO(?:CION)? DE ([A-Z ]+?)(?:[.,!?\n]|$)/
    );
    if (promo) add('promotion_id', `SUPER PROMO DE ${promo[1]}`);
    if (message.image_analysis?.category !== 'identity_document') continue;
    photoIds.push(message.id);
    for (const field of [
      'full_name',
      'document_type',
      'document_number',
      'birth_date',
      'address',
      'department',
      'district',
    ] as const)
      add(field, message.image_analysis.fields?.[field]);
  }
  const next = { ...data };
  // Conflicting OCR/text values remain empty for review; existing edits always win.
  for (const [field, values] of candidates) {
    if (!next[field] && values.size === 1)
      Object.assign(next, { [field]: [...values][0] });
  }
  const ids = [...new Set([...(data.identity_message_ids ?? []), ...photoIds])];
  if (!data.identity_confirmed && photoIds.length && ids.length <= 4)
    next.identity_message_ids = ids;
  if (guardianIds.length) next.guardian_message_ids = [...new Set([...(data.guardian_message_ids ?? []), ...guardianIds])].slice(0,4);
  return next;
}

/** Receipt fields are copied only after human validation by the caller. */
export function collectPaymentData(
  data: EnrollmentData,
  fields: Record<string, unknown> = {}
): EnrollmentData {
  const next = { ...data };
  const amount = fields.amount;
  if (
    !next.amount &&
    typeof amount === 'string' &&
    /^\d+(?:[.,]\d{1,2})?$/.test(amount.trim()) &&
    Number(amount.replace(',', '.')) > 0
  )
    next.amount = Number(amount.replace(',', '.')).toFixed(2);
  const institution =
    typeof fields.institution === 'string' ? key(fields.institution) : '';
  if (!next.payment_method && ['YAPE', 'PLIN'].includes(institution))
    next.payment_method = institution;
  const rawDate = typeof fields.date === 'string' ? key(fields.date) : '';
  const months = [
    'ENE',
    'FEB',
    'MAR',
    'ABR',
    'MAY',
    'JUN',
    'JUL',
    'AGO',
    'SEP',
    'OCT',
    'NOV',
    'DIC',
  ];
  let iso = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : '';
  const spanish = rawDate.match(
    /^(\d{1,2})\s+(ENE|FEB|MAR|ABR|MAY|JUN|JUL|AGO|SEP|OCT|NOV|DIC)[A-Z]*\.?\s+(\d{4})(?:\s|$)/
  );
  if (spanish)
    iso = `${spanish[3]}-${String(months.indexOf(spanish[2]) + 1).padStart(2, '0')}-${spanish[1].padStart(2, '0')}`;
  if (
    !next.payment_date &&
    iso &&
    !Number.isNaN(Date.parse(iso)) &&
    new Date(iso).toISOString().slice(0, 10) === iso
  )
    next.payment_date = iso;
  return next;
}
