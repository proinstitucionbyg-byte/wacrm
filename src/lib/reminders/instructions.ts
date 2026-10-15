import { suggestReminder } from './parse';

export interface ReminderDraft {
  label: string;
  body: string;
  dueLocal: string;
  repeatDays: number | null;
  needsInterval: boolean;
  sendIntent: boolean;
  destinationPhone: string | null;
  messageText: string | null;
}

/** A spoken RE1/recordatorio 1 starts a new item, never a new send by itself. */
export function splitReminderInstructions(text: string): string[] {
  const marker = /\b(?:RE\s*|R\s*|recordatorio\s+(?:n[uú]mero\s+)?)(\d{1,2}|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s*[:.)-]?\s*/gi;
  const hits = [...text.matchAll(marker)];
  if (!hits.length) return text.trim() ? [text.trim()] : [];
  const result: string[] = [];
  const first = text.slice(0, hits[0].index).trim();
  if (first) result.push(first);
  hits.forEach((hit, index) => {
    const start = (hit.index ?? 0) + hit[0].length;
    const end = index + 1 < hits.length ? hits[index + 1].index : text.length;
    const item = text.slice(start, end).trim();
    if (item) result.push(item);
  });
  return result;
}

function plain(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/** Only a clear instruction with a number AND quoted message text can send. */
export function parseReminderDrafts(text: string, now = new Date()): ReminderDraft[] {
  return splitReminderInstructions(text).map((body, index) => {
    const suggestion = suggestReminder(body, now);
    const normalized = plain(body);
    const sendIntent = /\b(?:envia|envias|enviale|envie|envies|enviar|enviarle|mandar|mandale|mandas|manda|escribe|escribir)\b.{0,45}\bmensaje\b|\bmensaje\b.{0,45}\b(?:enviar|mandar)\b/.test(normalized);
    const phone = body.match(/(?:\+?51[\s.-]?)?9(?:[\s.-]?\d){8}\b/);
    const destinationPhone = sendIntent && phone ? phone[0].replace(/\D/g, '').slice(-9) : null;
    // The actual outgoing text must be explicit. Never send the whole dictation.
    const afterPhone = phone ? body.slice((phone.index ?? 0) + phone[0].length) : '';
    const message = afterPhone.match(/\b(?:con el texto|que le diga|dici[eé]ndole|que diga|mensaje\s*:)\s*["“]?(.+?)["”]?\s*$/i)
      ?? afterPhone.match(/\bque\s+["“]?(.+?)["”]?\s*$/i);
    return {
      label: `RE${index + 1}`, body, dueLocal: suggestion.dueLocal,
      repeatDays: suggestion.repeatDays, needsInterval: suggestion.needsInterval, sendIntent,
      destinationPhone, messageText: destinationPhone ? message?.[1]?.trim() || null : null,
    };
  });
}
