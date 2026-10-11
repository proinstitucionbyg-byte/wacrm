import type { ChatMessage } from './types';
import { courseKey } from '@/lib/matriculas/calendar';
import { quotedOfferPrices } from '@/lib/matriculas/offer-prices';

/** Answer a public offer question from the actual sent audio, without another model call. */
export function sentOfferPriceReply(messages: ChatMessage[]): string | null {
  const question = [...messages].reverse().find(message => message.role === 'user')?.content ?? '';
  if (!/mensualidad|primer mes|segundo mes|cada mes|precio|costo|cu[aá]nto.{0,35}(?:pag|cuesta|cost)/i.test(question) || /deuda|saldo|mora|comprobante|voucher|valid|reembols|devoluc|certific|diploma|sueldo|salario/i.test(question)) return null;
  const course = [...messages].reverse().map(message => courseKey(message.content)).find(Boolean);
  if (!course) return null;
  for (const message of [...messages].reverse()) {
    if (message.role !== 'assistant' || !/^\[(?:AUDIO|OFERTA) ENVIAD[OA]:/.test(message.content) || courseKey(message.content) !== course) continue;
    const prices = quotedOfferPrices(message.content);
    // Never fall back to an older audio if the latest offer is incomplete.
    if (!prices) return null;
    return `En la promocion de ${course} que te compartimos, el primer mes cuesta S/${prices[0].toFixed(2)} y del segundo al sexto mes S/${prices[1].toFixed(2)} mensuales. 😊`;
  }
  return null;
}
