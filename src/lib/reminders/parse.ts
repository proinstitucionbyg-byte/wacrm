/** Suggest fields from Spanish speech/text. The adviser confirms before saving. */
export function suggestReminder(text: string, now = new Date()): { dueLocal: string; repeatDays: number | null; needsInterval: boolean } {
  const normalized = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const repeatNumber = normalized.match(/cada\s+(\d{1,3})\s+dias?/);
  const repeatDays = repeatNumber ? Number(repeatNumber[1])
    : /(?:cada dia|todos los dias|diariamente)/.test(normalized) ? 1
    : /(?:cada semana|semanalmente)/.test(normalized) ? 7 : null;
  const needsInterval = /cada\s+(?:unos|algunos)\s+dias/.test(normalized);
  const clock = normalized.match(/(?:a\s+las?\s+)?(\d{1,2})(?::(\d{2}))?\s*(?:de\s+la\s+)?(tarde|manana|noche|am|pm|a\.m\.|p\.m\.)/)
    ?? normalized.match(/(?:a\s+las?\s+)(\d{1,2})(?::(\d{2}))?/);
  const target = new Date(now);
  const morningIsTimeOfDay = /(?:de\s+la\s+|por\s+la\s+)manana/.test(normalized);
  const tomorrowIsMentioned = /\bmanana\b/.test(normalized)
    && (!morningIsTimeOfDay || (normalized.match(/\bmanana\b/g)?.length ?? 0) > 1);
  if (tomorrowIsMentioned) target.setDate(target.getDate() + 1);
  let hour = clock ? Number(clock[1]) : 9;
  const minute = clock?.[2] ? Number(clock[2]) : 0;
  const period = clock?.[3];
  if (period && /^(tarde|noche|pm|p\.m\.)$/.test(period) && hour < 12) hour += 12;
  if (period === 'noche' && hour === 12) hour = 0;
  if (period && /^(manana|am|a\.m\.)$/.test(period) && hour === 12) hour = 0;
  if (hour > 23 || minute > 59 || (clock && hour === 0 && Number(clock[1]) !== 12)) return { dueLocal: '', repeatDays, needsInterval };
  target.setHours(hour, minute, 0, 0);
  if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 1);
  const pad = (n: number) => String(n).padStart(2, '0');
  return { dueLocal: `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}T${pad(target.getHours())}:${pad(target.getMinutes())}`,
    repeatDays: repeatDays && repeatDays <= 365 ? repeatDays : null, needsInterval };
}
