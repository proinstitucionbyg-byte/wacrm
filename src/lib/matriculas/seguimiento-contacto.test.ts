import { describe, expect, it } from 'vitest';
import { evaluarSeguimientoContacto, type SeguimientoContacto } from './seguimiento-contacto';

const base: SeguimientoContacto = {
  matriculaId: 'SIMULACION-1', registradoEn: '2026-10-08T18:30:00-05:00', pagoValidado: true,
  documentosEntregados: { boleta: true, ficha: true, cronograma: true },
  bienvenidaEn: '2026-10-08T18:31:00-05:00', primerContactoEn: null, audioEn: null, alertaEn: null,
  asesora: 'ANTONELLA', asesoraEnTurnoAlVencer: true, origen: 'AUTOMATICO',
};
describe('Reglas de contacto de matriculas, sin mensajes reales', () => {
  it('espera dos horas exactas, sin confundir el plazo con la bienvenida', () => {
    expect(evaluarSeguimientoContacto(base, '2026-10-08T20:29:59-05:00').audioPendiente).toBe(false);
    const resultado = evaluarSeguimientoContacto(base, '2026-10-08T20:30:00-05:00');
    expect(resultado.audioPendiente).toBe(true); expect(resultado.alertaPendiente).toBe(true);
  });
  it('manda a preparar audio de madrugada sin acusar a una asesora fuera de turno', () => {
    const resultado = evaluarSeguimientoContacto({ ...base, registradoEn: '2026-10-09T00:00:00-05:00', bienvenidaEn: '2026-10-09T00:01:00-05:00', asesora: null, asesoraEnTurnoAlVencer: false }, '2026-10-09T02:00:00-05:00');
    expect(resultado.audioPendiente).toBe(true); expect(resultado.alertaPendiente).toBe(false);
  });
  it('contacto humano detiene audio y alerta y deja sin color', () => {
    const resultado = evaluarSeguimientoContacto({ ...base, primerContactoEn: '2026-10-08T19:00:00-05:00' }, '2026-10-08T20:30:00-05:00');
    expect(resultado.audioPendiente).toBe(false); expect(resultado.alertaPendiente).toBe(false); expect(resultado.color).toBe('SIN COLOR');
  });
  it('no repite eventos ya confirmados y conserva claves por matricula', () => {
    const resultado = evaluarSeguimientoContacto({ ...base, audioEn: '2026-10-08T20:30:00-05:00', alertaEn: '2026-10-08T20:30:00-05:00' }, '2026-10-08T20:31:00-05:00');
    expect(resultado.audioPendiente).toBe(false); expect(resultado.alertaPendiente).toBe(false);
    expect(resultado.clavesEnvio.audio).toBe('matricula:SIMULACION-1:audio');
  });
  it('no depende de una asesora para preparar bienvenida y espera documentos entregados', () => {
    expect(evaluarSeguimientoContacto({ ...base, bienvenidaEn: null, asesora: null }, '2026-10-08T18:30:00-05:00').bienvenidaPendiente).toBe(true);
    const resultado = evaluarSeguimientoContacto({ ...base, bienvenidaEn: null, documentosEntregados: { boleta: false, ficha: true, cronograma: true } }, '2026-10-08T20:30:00-05:00');
    expect(resultado.bienvenidaPendiente).toBe(false); expect(resultado.audioPendiente).toBe(false);
  });
  it('no envuelve una foto recibida como pago validado', () => {
    const resultado = evaluarSeguimientoContacto({ ...base, pagoValidado: false }, '2026-10-08T20:30:00-05:00');
    expect(resultado.bienvenidaPendiente).toBe(false); expect(resultado.audioPendiente).toBe(false); expect(resultado.alertaPendiente).toBe(false);
  });
  it('identifica pendientes manuales y rechaza horas ambiguas y eventos futuros', () => {
    expect(evaluarSeguimientoContacto({ ...base, origen: 'MANUAL' }, '2026-10-08T18:31:00-05:00').color).toBe('AMARILLO');
    expect(() => evaluarSeguimientoContacto(base, '2026-10-08T20:30:00')).toThrow('ZONA');
    expect(() => evaluarSeguimientoContacto(base, '2026-10-08T18:30:00-05:00')).toThrow('SECUENCIA');
  });
});
