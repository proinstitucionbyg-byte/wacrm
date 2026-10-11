import type { SupabaseClient } from '@supabase/supabase-js';
import { courseKey, loadAcademicCalendar, type AcademicModule } from './calendar';
import { engineSendText } from '@/lib/flows/meta-send';
import { routeConversationToArea } from '@/lib/ai/handoff-routing';

export interface AcademicTeacher { name: string; course: string; phones: string[] }
const clean = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
/** Explicit international prefixes only. Never invent a country for an unknown number. */
export function teacherPhone(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\+?[\d\s()-]+$/.test(value)) return null;
  const digits = value.replace(/\D/g, '');
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : null;
}
export function parseTeachers(value: unknown): AcademicTeacher[] | null {
  if (!Array.isArray(value) || value.length > 200) return null;
  const teachers: AcademicTeacher[] = [], phones = new Set<string>();
  for (const row of value) {
    if (!row || typeof row.name !== 'string' || !row.name.trim() || row.name.length > 200 || typeof row.course !== 'string' || !courseKey(row.course) || !Array.isArray(row.phones) || !row.phones.length || row.phones.length > 10) return null;
    const normalized = row.phones.map(teacherPhone);
    if (normalized.some((phone: string | null) => !phone || phones.has(phone)) || new Set(normalized).size !== normalized.length) return null;
    normalized.forEach((phone: string) => phones.add(phone));
    teachers.push({ name: row.name.trim(), course: courseKey(row.course)!, phones: normalized as string[] });
  }
  return teachers;
}
export function teacherCancellationIntent(text: string): boolean {
  const t = clean(text);
  return /reprogram|cancel.{0,15}clase|suspend.{0,15}clase|no (?:voy a poder|podre|puedo).{0,35}(?:clase|dictar|ensenar)|no (?:habra|hay|dare).{0,12}clase/.test(t);
}
/** Only unequivocal cancellation of today's scheduled class, in the last
 * thirty minutes before it or during its two hours, may act automatically. */
export function urgentTeacherClass(text: string, course: string, modules: AcademicModule[], now: Date): string | null {
  const t = clean(text), today = new Date(now.getTime() - 5 * 3_600_000).toISOString().slice(0, 10);
  if (!teacherCancellationIntent(text) || /\?|\b(?:no se reprograma|no reprogram|no cancel|no suspend|si (?:dare|puedo|voy a dar)|manana|ayer|proxima semana)\b/.test(t)) return null;
  const dates = [...t.matchAll(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{4}))?\b/g)];
  if (dates.some(m => `${m[3] || today.slice(0,4)}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}` !== today)) return null;
  // A different explicit course is never silently mapped to this teacher's course.
  const explicit = courseKey(text);
  if (explicit && explicit !== course) return null;
  if (!/\b(?:reprogramo|se reprograma|cancel[oa]|suspend[oa]|no (?:voy a poder|podre|puedo|habra|hay|dare))\b/.test(t)) return null;
  const selected = modules.filter(m => m.course === course && m.class_dates.includes(today));
  if (selected.length !== 1) return null;
  const start = Date.parse(`${today}T${selected[0].hour}:00-05:00`), delta = now.getTime() - start;
  return delta >= -30 * 60_000 && delta < 2 * 3_600_000 ? today : null;
}

export interface TeacherInbound { accountId: string; conversationId: string; contactId: string; userId: string; messageId: string; text: string; humanRecentlyActive: boolean }
export async function handleTeacherInbound(db: SupabaseClient, input: TeacherInbound): Promise<boolean> {
  if (!teacherCancellationIntent(input.text)) return false;
  const { data: directory, error } = await db.from('academic_teacher_directories').select('teachers,updated_at').eq('account_id', input.accountId).maybeSingle();
  if (error) throw error;
  const teachers = parseTeachers(directory?.teachers);
  if (!teachers?.length) return false;
  const { data: contact, error: contactError } = await db.from('contacts').select('phone,channel').eq('id', input.contactId).eq('account_id', input.accountId).maybeSingle();
  if (contactError) throw contactError;
  const phone = teacherPhone(contact?.phone), matched = contact?.channel === 'whatsapp' && phone ? teachers.filter(t => t.phones.includes(phone)) : [];
  const teacher = matched.length === 1 ? matched[0] : null;
  // A student asking about a cancellation is not automatically treated as a teacher.
  const selfIdentified = /\bsoy (?:el |la )?(?:docente|profesor|profesora)\b/.test(clean(input.text));
  if (!teacher && !selfIdentified && (/\?/.test(input.text) || !/(?:^|\byo )\s*(?:no (?:voy a poder|podre|puedo).{0,25}(?:dictar|dar la clase)|reprogramo|cancelo la clase)\b/.test(clean(input.text)))) return false;
  const recent = directory && Date.now() - Date.parse(directory.updated_at) < 30 * 60_000;
  const day = teacher && recent ? urgentTeacherClass(input.text, teacher.course, await loadAcademicCalendar(db, input.accountId), new Date()) : null;
  const { data: result, error: queueError } = await db.rpc('record_teacher_reschedule', {
    p_account: input.accountId, p_conversation: input.conversationId, p_message: input.messageId,
    p_course: teacher?.course ?? null, p_day: day, p_teacher: teacher?.name ?? null,
  });
  if (queueError) throw queueError;
  if (!result?.created) return true;
  await routeConversationToArea(db, input.accountId, input.conversationId, 'fidelizacion');
  if (!input.humanRecentlyActive) await engineSendText({ accountId: input.accountId, userId: input.userId, conversationId: input.conversationId, contactId: input.contactId,
    text: day ? 'Recibimos tu aviso urgente. Se está actualizando la programación y se ha notificado a fidelización para comunicar el cambio. La reprogramación se confirmará cuando termine la actualización.'
      : teacher ? 'Recibimos tu aviso y lo derivamos a fidelización para confirmar la reprogramación y su justificación. Aún no hemos cambiado las fechas.'
        : 'Recibimos tu aviso. Fidelización debe confirmar tu identidad y el curso porque escribes desde un número no autorizado. Aún no hemos cambiado las fechas.', aiGenerated: false });
  return true;
}
