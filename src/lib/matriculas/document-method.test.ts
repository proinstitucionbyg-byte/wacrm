import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const script = readFileSync(join(process.cwd(), 'docs/apps-script/DOCUMENTOS_MATRICULA.gs'), 'utf8');

describe('payment method on enrollment documents', () => {
  it.each(['INTERBANK', 'BBVA', 'BCP', 'TRANSFERENCIA', 'DEPOSITO'])(
    'accepts a validated bank payment from %s', (method) => {
      const context = createContext({});
      runInContext(script, context);
      context.method = method;
      expect(runInContext('D_METODO(method)', context)).toBe('Transferencia/Depósito');
    }
  );

  it('rejects an unknown payment method', () => {
    const context = createContext({});
    runInContext(script, context);
    expect(() => runInContext("D_METODO('DESCONOCIDO')", context)).toThrow('METODO DE PAGO NO RECONOCIDO');
  });
});
