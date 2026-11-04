// Header contract last checked in the native master on 29/10/2026 (COMUNICACIONES!A4:Q4).
export const CENTRAL_SPREADSHEET_ID = '1qg1xwDf0RIscrXFaupj-EuUzWEzfNNSrfHhglAIXbo8';
export const COMMUNICATION_HEADERS = [
  'Comunicacion_ID', 'Estudiante_ID', 'Matricula_ID', 'Finalidad', 'Canal',
  'Fecha prevista', 'Destino', 'Consentimiento / permiso', 'Texto / plantilla',
  'Costo previsto S/', 'Estado', 'Fecha envío real', 'ID proveedor',
  'Resultado / error', 'Responsable', 'Campana_ID', 'Intentos',
] as const;

/** Reads a clipboard table, including quoted tabs, newlines and escaped quotes. */
export function parseCentralTable(text: string) {
  if (text.length > 2_000_000) throw new Error('El lote supera el tamaño permitido. Divídelo antes de revisar.');
  const table: string[][] = [];
  let row: string[] = [], value = '', quoted = false, closed = false;
  const input = text.replace(/^\uFEFF/, '');
  const field = () => { row.push(value); value = ''; closed = false; };
  const line = () => { field(); table.push(row); row = []; };
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') { value += '"'; i++; }
        else { quoted = false; closed = true; }
      } else value += char;
      continue;
    }
    if (char === '\t') { field(); continue; }
    if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i++;
      line(); continue;
    }
    if (closed) throw new Error('Hay texto fuera de una celda entre comillas. Copia nuevamente la tabla de Sheets.');
    if (char === '"' && value === '') quoted = true;
    else value += char;
  }
  if (quoted) throw new Error('Una celda tiene comillas sin cerrar. Copia nuevamente la tabla de Sheets.');
  if (value || row.length || closed) line();
  while (table.length && table[0].every(v => v === '')) table.shift();
  while (table.length && table[table.length - 1].every(v => v === '')) table.pop();
  const headers = table.shift()?.map(v => v.trim());
  if (!headers || new Set(headers).size !== headers.length ||
    COMMUNICATION_HEADERS.some(h => !headers.includes(h))) {
    throw new Error('Copia la cabecera y las filas de COMUNICACIONES, desde A4 hasta Q.');
  }
  if (!table.length || table.length > 5000) throw new Error('Pega entre 1 y 5000 filas de comunicaciones.');
  if (headers.length > 64 || table.some(r => r.length > headers.length)) {
    throw new Error('Las columnas no coinciden con la cabecera. Copia nuevamente el rango completo.');
  }
  return { headers, rows: table.map(r => [...r, ...Array<string>(headers.length - r.length).fill('')]) };
}
