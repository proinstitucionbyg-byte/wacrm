import { parseEnrollmentData, type EnrollmentData } from './enrollment';
import { isGuardianMessage } from './identity-evidence';

export interface IntakeMessage {
  id: string;
  content_text: string | null;
  media_url?: string | null;
  created_at?: string;
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
const samePersonName = (left: string, right: string) =>
  key(left).split(' ').sort().join(' ') === key(right).split(' ').sort().join(' ');
const normalizeIdentityName = (value: unknown) => {
  if (typeof value !== 'string') return value;
  const parts = value.split(',').map(clean).filter(Boolean);
  return parts.length === 2 ? `${parts[1]} ${parts[0]}` : value;
};
const isBarePersonName = (value: string) =>
  /^[\p{L}]+(?:[ -][\p{L}]+){3,5}$/u.test(value) &&
  !/\b(SOY|TENGO|QUIERO|COMO|CUANDO|CURSO|NECESITO|HOLA|GRACIAS|AYUDA|PUEDO|CLASES|NOMBRE|CORREO|EMAIL|DISTRITO|DEPARTAMENTO|DIRECCION|DOCUMENTO|CELULAR|TELEFONO)\b|\b(?:INSCRIB|MATRICUL)\w*/.test(key(value));
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
  const photoCandidates = new Map<keyof EnrollmentData, Set<string>>();
  const writtenNames = new Set<string>();
  const photoNames = new Set<string>();
  const recentEmails = new Set<string>();
  const add = (field: keyof EnrollmentData, raw: unknown, written = false, photographed = false) => {
    if (typeof raw !== 'string' || !raw.trim() || raw.length > 500) return;
    const parsed = parseEnrollmentData({ [field]: raw });
    const value = parsed?.[field];
    if (typeof value !== 'string' || !value) return;
    const values = candidates.get(field) ?? new Set<string>();
    values.add(value);
    candidates.set(field, values);
    if (photographed) {
      const photographedValues = photoCandidates.get(field) ?? new Set<string>();
      photographedValues.add(value);
      photoCandidates.set(field, photographedValues);
    }
    if (written && field === 'full_name') writtenNames.add(value);
  };
  const photoIds: string[] = [];
  const guardianIds: string[] = [];
  const latestIdentityAt = Math.max(
    ...messages
      .filter((message) => message.image_analysis?.category === 'identity_document')
      .map((message) => Date.parse(message.created_at ?? ''))
      .filter(Number.isFinite)
  );
  const belongsToLatestIdentityBatch = (message: IntakeMessage) => {
    if (!Number.isFinite(latestIdentityAt) || !message.created_at) return true;
    const createdAt = Date.parse(message.created_at);
    return Number.isFinite(createdAt) && createdAt >= latestIdentityAt - 15 * 60_000;
  };
  for (const message of messages) {
    if (isGuardianMessage(message)) {
      if (message.image_analysis?.category === 'identity_document') guardianIds.push(message.id);
      continue;
    }
    // Some captions arrive with literal backslash-n from the sender.
    const text = (message.content_text ?? '').replace(/\\n/g, '\n');
    const trimmed = text.trim();
    // Students often answer the prompted fields as separate bare messages.
    // Accept only unambiguous shapes; a question or conversational sentence
    // must never become a name, course or document by inference.
    const currentIdentityBatch = belongsToLatestIdentityBatch(message);
    const addEmail = (raw: string) => {
      add('email', raw);
      if (currentIdentityBatch) {
        const parsed = parseEnrollmentData({ email: raw })?.email;
        if (parsed) recentEmails.add(parsed);
      }
    };
    if (/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(trimmed)) addEmail(trimmed);
    const bareCourse = courses.filter(([pattern]) =>
      new RegExp(`^${pattern.source}$`, pattern.flags).test(key(trimmed)));
    if (bareCourse.length === 1) add('course', bareCourse[0][1]);
    if (isBarePersonName(trimmed) && bareCourse.length === 0) add('full_name', trimmed, true);
    for (const line of text.split(/\r?\n/)) {
      const lineValue = line.trim();
      const isExactCourse = courses.some(([pattern]) =>
        new RegExp(`^${pattern.source}$`, pattern.flags).test(key(lineValue)));
      if (currentIdentityBatch && !isExactCourse && isBarePersonName(lineValue)) add('full_name', lineValue, true);
      const labelled = line.match(
        /^\s*(nombre(?: completo)?|nombres(?: y apellidos)?|correo(?: electronico)?|email|celular(?:\s*[12])?|telefono(?:\s*[12])?|dni|documento(?: de identidad)?|carn[eé] de extranjer[ií]a|pasaporte|fecha de nacimiento|direccion|dirección|departamento|distrito|curso|promocion)\s*(?:(?::|-|\.)\s*|\s+)(.+)$/i
      );
      if (!labelled) continue;
      const label = key(labelled[1]);
      const value = labelled[2];
      if (/^NOMBRE/.test(label) && currentIdentityBatch) add('full_name', value, true);
      else if (/^(CORREO|EMAIL)/.test(label)) addEmail(value);
      else if (/^(CELULAR|TELEFONO)/.test(label)) {
        const phone = value.replace(/[\s()-]/g, '');
        // Unnumbered supplied phone is additional to the WhatsApp contact number.
        const field = /1$/.test(label) || (!data.phone1 && !/2$/.test(label)) ? 'phone1' : 'phone2';
        if (
          /^\+?\d{7,15}$/.test(phone) &&
          phone.replace(/^\+/, '') !== data.phone1?.replace(/^\+/, '')
        )
          add(field, phone);
      } else if (['DNI','DOCUMENTO','DOCUMENTO DE IDENTIDAD','CARNE DE EXTRANJERIA','PASAPORTE'].includes(label) && /^[A-Z0-9\s-]+$/i.test(value.trim())) {
        add('document_type', label.startsWith('DOCUMENTO') && /^\d{8}$/.test(value.trim()) ? 'DNI' : label);
        add('document_number', value);
      } else if (label === 'FECHA DE NACIMIENTO') {
        const date = value.trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
        add('birth_date', date ? `${date[3]}-${date[2].padStart(2,'0')}-${date[1].padStart(2,'0')}` : value);
      } else if (['DIRECCION','DEPARTAMENTO','DISTRITO'].includes(label)) {
        add(({DIRECCION:'address', DEPARTAMENTO:'department', DISTRITO:'district'} as const)[label as 'DIRECCION'|'DEPARTAMENTO'|'DISTRITO'],value);
      } else if (label === 'PROMOCION') add('promotion_id', value);
    }
    for (const line of text.split(/\r?\n/)) {
      const value = line.trim();
      if (/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(value)) addEmail(value);
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
    if (message.image_analysis?.category !== 'identity_document' || !currentIdentityBatch) continue;
    photoIds.push(message.id);
    const isReverse = Boolean(message.image_analysis.fields?.address);
    const photoName = isReverse ? undefined : parseEnrollmentData({
      full_name: normalizeIdentityName(message.image_analysis.fields?.full_name),
    })?.full_name;
    if (photoName) photoNames.add(photoName);
    for (const field of [
      'full_name',
      'document_type',
      'document_number',
      'birth_date',
      'address',
      'department',
      'district',
    ] as const) {
      if (field === 'full_name' && isReverse) continue;
      // The reverse may contain electoral/printing codes, not the holder's ID.
      if ((field === 'document_number' || field === 'document_type') && !message.image_analysis.fields?.full_name) continue;
      if (
        field === 'document_number' &&
        key(String(message.image_analysis.fields?.document_type ?? '')) === 'DNI' &&
        !/^\d{8}$/.test(String(message.image_analysis.fields?.document_number ?? '').replace(/[\s()-]/g, ''))
      ) continue;
      add(
        field,
        field === 'full_name'
          ? normalizeIdentityName(message.image_analysis.fields?.[field])
          : message.image_analysis.fields?.[field],
        false,
        true
      );
    }
  }
  const next = { ...data };
  // While identity is still pending, recalculate identity fields from the
  // newest front/back batch. This repairs an earlier bad OCR attempt instead
  // of permanently keeping the first value written into the draft.
  if (!data.identity_confirmed && photoIds.length) {
    for (const field of ['full_name','document_type','document_number','birth_date','address','department','district'] as const)
      delete next[field];
  }
  // Conflicting OCR/text values remain empty for review. The address printed
  // on the reverse of the document wins over an older address typed in chat.
  for (const [field, values] of candidates) {
    // A student's explicit written name is kept as provisional data even
    // when OCR yields a different spelling. If ordinary chat phrases also
    // resemble a name, prefer the single written value that matches the DNI.
    const writtenPhotoMatches = field === 'full_name'
      ? [...writtenNames].filter((name) => [...photoNames].some((photoName) => samePersonName(name, photoName)))
      : [];
    const photographed = photoCandidates.get(field);
    const chosen = field === 'full_name' && writtenPhotoMatches.length === 1
      ? writtenPhotoMatches[0]
      : field === 'full_name' && writtenNames.size === 1
        ? [...writtenNames][0]
        : ['address','department','district'].includes(field) && photographed?.size === 1
          ? [...photographed][0]
        : field === 'email' && recentEmails.size === 1
          ? [...recentEmails][0]
        : values.size === 1 ? [...values][0] : null;
    if (!next[field] && chosen) Object.assign(next, { [field]: chosen });
  }
  const ids = data.identity_confirmed
    ? [...new Set([...(data.identity_message_ids ?? []), ...photoIds])]
    : [...new Set(photoIds)];
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
  if (!next.payment_method && ['YAPE', 'PLIN', 'INTERBANK', 'BBVA', 'BCP'].includes(institution))
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
  // Receipt OCR often includes the time (for example, "2026-10-20 20:50").
  // Keep only its ISO calendar date; the full timestamp is not needed here.
  let iso = rawDate.match(/^(\d{4}-\d{2}-\d{2})(?:[ T].*)?$/)?.[1] ?? '';
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
