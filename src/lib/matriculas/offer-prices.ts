/** Only amounts explicitly attached to the first month and monthly fee. */
export function quotedOfferPrices(value: string): number[] | null {
  const quote = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
    .replace(/\\N/g, '\n').replace(/~[^~]*~/g, '').replace(/[*_]/g, '');
  if (!/6\s*MESES|SEIS\s*MESES/.test(quote)) return null;
  const first = quote.match(/(?:1(?:RA|ERA)?\s*(?:CUOTA|MES)|PRIMER[AO]?\s*(?:MES|CUOTA))[^\n\d]{0,80}?(?:S\s*\/?\s*(\d+(?:[.,]\d{1,2})?)|(\d+[.,]\d{1,2})(?!\d))/);
  const monthly = quote.match(/MENSUALIDAD\s+REGULAR[^\n]{0,100}?(?:\d+(?:[.,]\d{1,2})?)[^\n]{0,100}?\bPERO\b[^\n\d]{0,80}?(?:S\s*\/?\s*(\d+(?:[.,]\d{1,2})?)|(\d+[.,]\d{1,2})(?!\d))/)
    ?? quote.match(/(?:2DA?\s*A\s*LA\s*6TA?\s*PENSION|SEGUND[AO]\s*(?:MES|CUOTA|PENSION))[^\n\d]{0,80}?(?:S\s*\/?\s*(\d+(?:[.,]\d{1,2})?)|(\d+[.,]\d{1,2})(?!\d))/)
    ?? quote.match(/MENSUALIDAD[^\n]{0,180}?PRECIO PROMOCIONAL[^\n\d]{0,40}?(?:S\s*\/?\s*(\d+(?:[.,]\d{1,2})?)|(\d+[.,]\d{1,2})(?!\d))/)
    ?? quote.match(/(?:MENSUALIDAD|SEGUND[AO]\s*(?:MES|CUOTA))[^\n\d]{0,80}?(?:S\s*\/?\s*(\d+(?:[.,]\d{1,2})?)|(\d+[.,]\d{1,2})(?!\d))/);
  if (!first || !monthly) return null;
  const prices = [Number((first[1] || first[2]).replace(',', '.')), ...Array(5).fill(Number((monthly[1] || monthly[2]).replace(',', '.')))];
  return prices.every(price => price > 0) ? prices : null;
}
