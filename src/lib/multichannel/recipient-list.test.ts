import { describe, expect, it } from 'vitest';
import { parseRecipientList, limaInputToISO, remainingRecipientList } from './recipient-list';

const header='ID\tDestino\tNombre\tPermiso\tPago\n';
describe('lista pegada desde hojas de cálculo',()=>{
  it('lee tabulaciones y conserva los números reales sin convertirlos en destinos de prueba',()=>{
    expect(parseRecipientList(header+'001\t51934215366\tEjemplo\tSí\tPendiente')[0]).toEqual({
      id:'001',destination:'51934215366',permission_confirmed:true,payment_status:'pending',variables:{nombre:'Ejemplo'},
    });
  });
  it('permiso vacío o No nunca significa autorización; pago vacío queda desconocido',()=>{
    const rows=parseRecipientList(header+'a\tTEST-a\tA\tNo\tResuelto\nb\tTEST-b\tB\t\t');
    expect(rows[0]).toMatchObject({permission_confirmed:false,payment_status:'resolved'});
    expect(rows[1]).toMatchObject({permission_confirmed:false,payment_status:'unknown'});
  });
  it('ignora líneas vacías y BOM de archivos, manteniendo columnas vacías',()=>{
    expect(parseRecipientList('\uFEFF\n'+header+'a\tTEST-a\t\tPendiente\t\n\n')).toHaveLength(1);
  });
  it('no adivina cabeceras, columnas, permisos ni pagos desconocidos',()=>{
    for(const input of [header.replace('Destino','Teléfono')+'a',header+'a\tTEST-a',
      header+'a\tTEST-a\tA\tquizás\tPendiente',header+'a\tTEST-a\tA\tSí\tpagó algo']) {
      expect(()=>parseRecipientList(input)).toThrow();
    }
  });
  it('limita el volumen sin truncar ni descartar filas silenciosamente',()=>{
    expect(()=>parseRecipientList(header)).toThrow();
    expect(()=>parseRecipientList(header+Array.from({length:5001},(_,i)=>`${i}\tTEST-${i}\tA\tSí\tPendiente`).join('\n'))).toThrow();
  });
  it('el siguiente lote conserva solo los diferidos, sin reintroducir listos o repetidos',()=>{
    const text=header+'a\tTEST-a\tA\tSí\tPendiente\nb\tTEST-b\tB\tSí\tPendiente\nb\tTEST-b\tB\tSí\tPendiente';
    expect(parseRecipientList(remainingRecipientList(text,[{recipient_id:'b',destination:'TEST-b'}])).map(r=>r.id)).toEqual(['b']);
  });
});
describe('horario de Lima independiente de la laptop',()=>{
  it('convierte a UTC manteniendo el día correcto',()=>{
    expect(limaInputToISO('2027-01-01T23:30')).toBe('2027-01-02T04:30:00.000Z');
  });
  it('rechaza fechas imposibles o formatos ambiguos',()=>{
    for(const value of ['2027-02-30T09:00','2027-01-01T25:00','01/01/2027 09:00','']) {
      expect(()=>limaInputToISO(value)).toThrow();
    }
  });
});
