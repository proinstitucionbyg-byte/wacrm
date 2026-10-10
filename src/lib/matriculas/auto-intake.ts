import type { EnrollmentData } from './enrollment';
import type { IntakeMessage } from './collect-data';
import { academicOffer, courseKey, type AcademicModule } from './calendar';
export interface IntakeEvidence extends IntakeMessage { sender_type?: string; ai_generated?: boolean; created_at?: string }
const key = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toUpperCase();
/** Matching written identifiers to the photo is not payment validation. The caller requires the CEO's payment decision first. */
export function prepareAutomaticIntake(data: EnrollmentData, messages: IntakeEvidence[], calendar: AcademicModule[], receivedAt: string): EnrollmentData {
  const next = { ...data };
  const customer = messages.filter((message) => message.sender_type === 'customer');
  if (!next.identity_confirmed && next.full_name && next.document_number) {
    const writtenNames = new Set<string>(), writtenDocs = new Set<string>();
    for (const message of customer) for (const line of (message.content_text ?? '').replace(/\\n/g, '\n').split(/\r?\n/)) {
      const normalizedLine = key(line);
      const name = normalizedLine.match(/^(?:NOMBRE(?: COMPLETO)?|NOMBRES(?: Y APELLIDOS)?)\s*:\s*(.+)$/);
      const doc = normalizedLine.match(/^(?:DNI|DOCUMENTO(?: DE IDENTIDAD)?|CARNE DE EXTRANJERIA|PASAPORTE)\s*:\s*(.+)$/);
      if (name) writtenNames.add(key(name[1]));
      if (doc) writtenDocs.add(key(doc[1]).replace(/[\s()-]/g, ''));
    }
    const photos = customer.filter((message) => message.image_analysis?.category === 'identity_document');
    const consistent = photos.every((photo) => {
      const f = photo.image_analysis?.fields;
      return (!f?.full_name || key(String(f.full_name)) === key(next.full_name!)) && (!f?.document_number || key(String(f.document_number)).replace(/\s/g, '') === next.document_number);
    });
    const front = photos.some((photo) => key(String(photo.image_analysis?.fields?.full_name ?? '')) === key(next.full_name!) && String(photo.image_analysis?.fields?.document_number ?? '').replace(/\s/g, '') === next.document_number);
    if (consistent && front && writtenNames.size === 1 && writtenNames.has(key(next.full_name)) && writtenDocs.size === 1 && writtenDocs.has(next.document_number)) next.identity_confirmed = true;
  }
  if (!next.offer_confirmed && next.course) {
    const quotes = messages.filter((message) => message.sender_type === 'bot' && message.ai_generated !== true && message.created_at && message.created_at <= receivedAt).map((message) => key(message.content_text ?? '').replace(/\\N/g, '\n').replace(/[*_~]/g, '')).filter((text) => courseKey(text) === courseKey(next.course!));
    const prices = new Map<string, number[]>();
    for (const quote of quotes) {
      const first = quote.match(/(?:1(?:RA|ERA)?\s*(?:CUOTA|MES)|PRIMER[AO]?\s*(?:MES|CUOTA))[^\n]{0,60}?S\s*\/?\s*(\d+(?:[.,]\d{1,2})?)/);
      const monthly = quote.match(/(?:MENSUALIDAD|SEGUND[AO]\s*(?:MES|CUOTA))[^\n]{0,60}?S\s*\/?\s*(\d+(?:[.,]\d{1,2})?)/);
      if (!first || !monthly || !/6\s*MESES|SEIS\s*MESES/.test(quote)) continue;
      const values = [Number(first[1].replace(',', '.')), ...Array(5).fill(Number(monthly[1].replace(',', '.')))];
      if (values.every((value) => value > 0)) prices.set(JSON.stringify(values), values);
    }
    if (prices.size === 1) {
      next.prices = [...prices.values()][0];
      next.promotion_id ||= `OFERTA ${next.prices[0].toFixed(2)} + 5 CUOTAS ${next.prices[1].toFixed(2)}`;
      next.offer_confirmed = true;
    }
  }
  if (!next.start_date && next.course) next.start_date = academicOffer(calendar, next.course, new Date(receivedAt))?.start_date;
  return next;
}
