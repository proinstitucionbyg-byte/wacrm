export function commandName(text: string): string | null {
  const match = /^MANDAR\s*\(([^\r\n]{1,160})\)\s*$/i.exec(text.trim());
  return match?.[1].trim() || null;
}
export function isInboxCommand(text: string): boolean {
  return /^MANDAR\b/i.test(text.trim());
}
export function normalizedCommand(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}
export function resolveCommand<T extends { id: string; name: string }>(
  name: string,
  blocks: T[]
): T | null {
  const matches = blocks.filter(
    (block) => normalizedCommand(block.name) === normalizedCommand(name)
  );
  if (matches.length) return matches.length === 1 ? matches[0] : null;
  // Public adviser wording and the existing block name refer to the same block.
  // Do not include bank accounts or post-payment flows in this alias.
  const paymentAlias = (value: string) => /^(?:MEDIOS? DE PAGOS?|YAPE(?: O| Y)? PLIN|YAPE|PLIN)$/.test(normalizedCommand(value));
  if (paymentAlias(name)) {
    const paymentBlocks = blocks.filter((block) => paymentAlias(block.name));
    return paymentBlocks.length === 1 ? paymentBlocks[0] : null;
  }
  const query = commandTokens(name);
  // A course alone is not an instruction to send a promotion. Require intent,
  // and reject ambiguous offers instead of choosing a price on the adviser's behalf.
  if (!query.some((word) => ['PROMO', 'MALLA', 'PAGO'].includes(word))) return null;
  const candidates = blocks.filter((block) => {
    const tokens = commandTokens(block.name);
    return query.every((word) => tokens.some((token) => closeWord(word, token)));
  });
  return candidates.length === 1 ? candidates[0] : null;
}

const OMIT = new Set(['DE', 'DEL', 'EL', 'LA', 'LOS', 'LAS', 'UN', 'UNA', 'CURSO', 'SUPER', 'AUXILIAR', 'CURRICULAR', 'Y']);
function commandTokens(value: string): string[] {
  const words = normalizedCommand(value).match(/[A-Z]+|\d+(?:[.,]\d+)?/g) ?? [];
  return [...new Set(words.filter((word) => word.length > 1 && !OMIT.has(word)).map((word) => {
    if (word.startsWith('PROMO')) return 'PROMO';
    if (/^(MALLA|MAYA|TEMARIO)/.test(word)) return 'MALLA';
    if (/^(PAGOS?|ABONO|TRANSFERENCIA)$/.test(word)) return 'PAGO';
    if (/^(ADMIN|ASISTENT)/.test(word)) return 'ADMIN';
    if (word === 'HUMANOS') return 'RECURSOS';
    if (word === 'INICIAL') return 'EDUCACION';
    if (word === 'DIETETICA') return 'NUTRICION';
    return word.replace(',', '.');
  }))];
}
function closeWord(a: string, b: string): boolean {
  if (a === b) return true;
  if (a === 'PROMO') return /^\d+[.]\d{2}$/.test(b);
  if (/\d/.test(a + b) || Math.min(a.length, b.length) < 5) return false;
  // Small typing mistakes only. No model call, no extra tokens.
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + Number(a[i - 1] !== b[j - 1]));
    row = next;
  }
  return row[b.length] <= (Math.min(a.length, b.length) >= 8 ? 2 : 1);
}
