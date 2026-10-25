import type { EnrollmentData } from './enrollment';
import type { IntakeMessage } from './collect-data';
import { intakeText } from './intake-text';

const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toUpperCase();
export function isGuardianMessage(message: IntakeMessage): boolean {
  return /\b(?:TUTOR|PADRE|MADRE|APODERAD[OA])\b/.test(normalize(message.content_text ?? ''));
}
/** Retain actual customer declarations, never manufacture an identity document or mark OCR confirmed. */
export function declarationEvidence(data: EnrollmentData, messages: IntakeMessage[]): string[] {
  if (!data.full_name || !data.document_number || !data.email) return [];
  const names = new Set<string>(), documents = new Set<string>(), emails = new Set<string>();
  const ids = new Set<string>();
  for (const message of messages) {
    if (isGuardianMessage(message)) continue;
    for (const line of intakeText(message.content_text).split(/\r?\n/)) {
      const normalized = normalize(line);
      const match = normalized.match(/^(NOMBRE(?: COMPLETO)?|NOMBRES(?: Y APELLIDOS)?|DNI|DOCUMENTO(?: DE IDENTIDAD)?|CARNE DE EXTRANJERIA|PASAPORTE|CORREO(?: ELECTRONICO)?|EMAIL)\s*:\s*(.+)$/);
      if (!match) {
        if (/^[\p{L}]+(?:[ -][\p{L}]+){3,5}$/u.test(line.trim()) && normalized === normalize(data.full_name)) { names.add(normalized); ids.add(message.id); }
        else if (normalized.replace(/[\s()-]/g, '') === normalize(data.document_number)) { documents.add(normalized.replace(/[\s()-]/g, '')); ids.add(message.id); }
        else if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(line.trim()) && normalized === normalize(data.email)) { emails.add(normalized); ids.add(message.id); }
        continue;
      }
      const [,label,value] = match;
      const target = /^NOMBRE/.test(label) ? names : /CORREO|EMAIL/.test(label) ? emails : documents;
      target.add(target === documents ? value.replace(/[\s()-]/g, '') : value);
      ids.add(message.id);
    }
  }
  if (names.size !== 1 || !names.has(normalize(data.full_name)) || documents.size !== 1 || !documents.has(normalize(data.document_number)) || emails.size !== 1 || !emails.has(normalize(data.email)) || ids.size > 4) return [];
  return [...ids];
}
