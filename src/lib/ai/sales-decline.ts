/** Only an explicit refusal stops the sales sequence. An objection can still be answered. */
export function isExplicitSalesDecline(text: string): boolean {
  const normalized = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (/\b(?:pero|sino)\b/.test(normalized)) return false;
  return /^(?:(?:por favor )?(?:no estoy interesad[oa]|no me interesa|no deseo (?:mas )?informacion|no quiero (?:mas )?informacion|no me escriban|dejen de escribirme))\b/.test(normalized);
}
