import type { EnrollmentData } from './enrollment';

export type ManualEvidenceSource = 'call' | 'other_whatsapp';
export function manualEvidenceIssue(data: EnrollmentData, source: unknown, phone: unknown, confirmed: unknown): string | null {
  if (confirmed !== true) return 'Marca que comprobaste los datos con el estudiante.';
  if (source !== 'call' && source !== 'other_whatsapp') return 'Elige llamada u otro WhatsApp.';
  if (typeof phone !== 'string' || !/^\+?\d{7,15}$/.test(phone)) return 'Escribe el teléfono donde confirmaste los datos, incluido el código de país.';
  if (!data.full_name?.trim() || !data.document_type || !data.document_number?.trim() || !data.email?.trim()) return 'Completa nombre, tipo y número de documento y correo antes de confirmar.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) return 'Revisa el correo electrónico.';
  if (data.document_type === 'DNI' && !/^\d{8}$/.test(data.document_number)) return 'El DNI debe tener ocho dígitos.';
  return null;
}
export function manualEvidenceMatches(data: EnrollmentData, analysis: { category?: string; fields?: Record<string, unknown> } | null | undefined): boolean {
  if (analysis?.category !== 'staff_confirmed_identity') return false;
  const key = (value: unknown) => String(value ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
  return ['full_name', 'document_type', 'document_number', 'email'].every(field => key(data[field as keyof EnrollmentData]) && key(data[field as keyof EnrollmentData]) === key(analysis.fields?.[field]));
}
