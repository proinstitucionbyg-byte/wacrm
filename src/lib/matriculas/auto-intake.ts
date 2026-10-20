import type { EnrollmentData } from './enrollment';
import type { IntakeMessage } from './collect-data';
import { academicOffer, courseKey, type AcademicModule } from './calendar';
import { declarationEvidence, isGuardianMessage } from './identity-evidence';
import { quotedOfferPrices } from './offer-prices';
export interface IntakeEvidence extends IntakeMessage { sender_type?: string; ai_generated?: boolean; created_at?: string }
const key = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toUpperCase();
const sameName = (left: string, right: string) => {
  const words = (value: string) => key(value).split(' ').sort().join(' ');
  return words(left) === words(right);
};
/** Matching written identifiers to the photo is not payment validation. The caller requires the CEO's payment decision first. */
export function prepareAutomaticIntake(data: EnrollmentData, messages: IntakeEvidence[], calendar: AcademicModule[], receivedAt: string): EnrollmentData {
  const next = { ...data };
  const customer = messages.filter((message) => message.sender_type === 'customer' && !isGuardianMessage(message));
  if (!next.identity_confirmed && next.full_name && next.document_number) {
    const writtenNames = new Set<string>(), writtenDocs = new Set<string>();
    for (const message of customer) for (const line of (message.content_text ?? '').replace(/\\n/g, '\n').split(/\r?\n/)) {
      const normalizedLine = key(line);
      const name = normalizedLine.match(/^(?:NOMBRE(?: COMPLETO)?|NOMBRES(?: Y APELLIDOS)?)\s*(?:(?::|-)\s*|\s+)(.+)$/);
      const doc = normalizedLine.match(/^(?:DNI|DOCUMENTO(?: DE IDENTIDAD)?|CARNE DE EXTRANJERIA|PASAPORTE)\s*(?:(?::|-)\s*|\s+)(.+)$/);
      if (name) writtenNames.add(key(name[1]));
      else if (/^[\p{L}]+(?:[ -][\p{L}]+){3,5}$/u.test(line.trim()) && sameName(line,next.full_name)) writtenNames.add(key(line));
      if (doc) writtenDocs.add(key(doc[1]).replace(/[\s()-]/g, ''));
      else if (normalizedLine.replace(/[\s()-]/g, '') === next.document_number) writtenDocs.add(next.document_number);
    }
    const photos = customer.filter((message) => message.image_analysis?.category === 'identity_document');
    const consistent = photos.every((photo) => {
      const f = photo.image_analysis?.fields;
      const photographedDocument = key(String(f?.document_number ?? '')).replace(/[\s()-]/g, '');
      const reverseDniArtifact = next.document_type === 'DNI' && Boolean(photographedDocument) &&
        !/^\d{8}$/.test(photographedDocument) && !f?.birth_date &&
        Boolean(f?.address || f?.department || f?.district);
      if (reverseDniArtifact) return true;
      return !f?.full_name || (sameName(String(f.full_name), next.full_name!) && (!f.document_number || key(String(f.document_number)).replace(/\s/g, '') === next.document_number));
    });
    const front = photos.some((photo) => sameName(String(photo.image_analysis?.fields?.full_name ?? ''), next.full_name!) && String(photo.image_analysis?.fields?.document_number ?? '').replace(/\s/g, '') === next.document_number);
    if (consistent && front && writtenNames.size === 1 && sameName([...writtenNames][0], next.full_name) && writtenDocs.size <= 1 && (writtenDocs.size === 0 || writtenDocs.has(next.document_number))) next.identity_confirmed = true;
  }
  const photos = customer.filter(message => message.image_analysis?.category === 'identity_document');
  // A contradictory photo must be resolved, not bypassed with the written-data exception.
  if (!next.identity_confirmed && photos.length === 0) {
    next.declaration_message_ids = declarationEvidence(next, customer);
  } else next.declaration_message_ids = [];
  if (!next.offer_confirmed && next.course) {
    const quotes = messages.filter((message) => message.sender_type === 'bot' && message.ai_generated !== true && message.created_at && message.created_at <= receivedAt).map((message) => ({
      createdAt: Date.parse(message.created_at!),
      text: key(message.content_text ?? '').replace(/\\N/g, '\n').replace(/~[^~]*~/g, '').replace(/[*_]/g, ''),
    })).filter((entry) => Number.isFinite(entry.createdAt) && courseKey(entry.text) === courseKey(next.course!));
    const latestQuoteAt = Math.max(...quotes.map((entry) => entry.createdAt));
    const prices = new Map<string, number[]>();
    // Compare the text/audio belonging to the latest promotion block. Older
    // campaigns in the same chat must not override the offer accepted at pay.
    for (const quote of quotes.filter((entry) => entry.createdAt >= latestQuoteAt - 10 * 60_000)) {
      const values = quotedOfferPrices(quote.text);
      if (values) prices.set(JSON.stringify(values), values);
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
