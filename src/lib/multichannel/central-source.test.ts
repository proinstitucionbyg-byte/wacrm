import { describe, expect, it } from 'vitest';
import { COMMUNICATION_HEADERS, parseCentralTable } from './central-source';

const header = COMMUNICATION_HEADERS.join('\t');
const quote = (v: string) => /[\t\r\n"]/.test(v) ? '"'+v.replace(/"/g,'""')+'"' : v;
const values = (body = 'Aviso ficticio.') => {
  const row = Array<string>(17).fill('');
  row[0] = 'COM-1'; row[1] = 'EST-1'; row[8] = body; row[15] = 'CAMP-1'; return row;
};

describe('tabla copiada de COMUNICACIONES', () => {
  it('lee cabeceras actuales con BOM y conserva texto multilinea, comillas y tabulaciones', () => {
    const body = 'Hola "estudiante".\nTu curso\tcontinúa mañana. 🎓';
    const result = parseCentralTable('\uFEFF'+header+'\r\n'+values(body).map(quote).join('\t')+'\r\n');
    expect(result.headers).toEqual([...COMMUNICATION_HEADERS]);
    expect(result.rows[0][8]).toBe(body);
  });
  it('conserva las filas vacías interiores para mantener la referencia de origen', () => {
    const result = parseCentralTable(header+'\n'+values().join('\t')+'\n\n'+values().join('\t')+'\n\n');
    expect(result.rows).toHaveLength(3); expect(result.rows[1]).toEqual(Array(17).fill(''));
  });
  it('admite columnas reordenadas y campos finales vacíos', () => {
    const result = parseCentralTable([...COMMUNICATION_HEADERS].reverse().join('\t')+'\nX\tY');
    expect(result.rows[0]).toHaveLength(17); expect(result.rows[0].slice(0,3)).toEqual(['X','Y','']);
  });
  it('no interpreta tablas incompletas, con columnas extra o comillas sin cerrar', () => {
    for (const text of ['ID\tDestino\nA\tTEST-a', header+'\n"sin cerrar',
      header+'\n"cerrado"texto', header+'\n'+Array(18).fill('x').join('\t'), header]) {
      expect(()=>parseCentralTable(text)).toThrow();
    }
  });
  it('rechaza cabeceras duplicadas y listas que exceden los límites', () => {
    expect(()=>parseCentralTable(header+'\tDestino\nX')).toThrow();
    expect(()=>parseCentralTable(header+'\n'+Array(5001).fill('x').join('\n'))).toThrow();
    expect(()=>parseCentralTable('x'.repeat(2_000_001))).toThrow();
  });
});
