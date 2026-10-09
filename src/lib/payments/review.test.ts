import { describe, expect, it } from 'vitest';
import { isPaymentStatus, parsePaymentDecision } from './review';
describe('decision humana de pago', () => {
  it('acepta validacion explicita y conserva la version revisada', () => {
    expect(parsePaymentDecision({ status: 'validated', version: 1, note: '  Revisado  ' })).toEqual({ status: 'validated', version: 1, note: 'Revisado' });
  });
  it('exige un motivo para rechazos y observaciones', () => {
    for (const status of ['rejected', 'observation']) {
      expect(parsePaymentDecision({ status, version: 1, note: '  ' })).toBeNull();
      expect(parsePaymentDecision({ status, version: 1, note: 'Falta dato' })).not.toBeNull();
    }
  });
  it('rechaza estados o versiones inventados y notas demasiado largas', () => {
    for (const body of [null, {}, { status: 'pending', version: 1, note: '' }, { status: 'approved', version: 1, note: '' }, { status: 'validated', version: 0, note: '' }, { status: 'validated', version: 1.5, note: '' }, { status: 'validated', version: 1, note: 'a'.repeat(2001) }]) expect(parsePaymentDecision(body)).toBeNull();
    expect(isPaymentStatus('pending')).toBe(true);
  });
});
