import { describe, expect, it } from 'vitest';
import { normalizeSalesCommercialStatus, SALES_COMMERCIAL_STATUSES } from './commercial-status';

it.each(['CONTACTADO', 'PROSPECTO A COMPRAR'])('accepts the commercial state %s', status => {
  expect(normalizeSalesCommercialStatus(status.toLowerCase())).toBe(status);
});

describe('normalizeSalesCommercialStatus', () => {
  it('accepts the supported status labels case-insensitively', () => {
    expect(normalizeSalesCommercialStatus('interesado')).toBe('INTERESADO');
    expect(normalizeSalesCommercialStatus('seguimiento de ventas')).toBe('SEGUIMIENTO DE VENTAS');
    expect(SALES_COMMERCIAL_STATUSES).toContain('NO INTERESADO-R');
    expect(normalizeSalesCommercialStatus('número de competencia')).toBe('NÚMERO DE COMPETENCIA');
  });

  it('allows clearing a status but rejects unsupported values and types', () => {
    expect(normalizeSalesCommercialStatus(null)).toBeNull();
    expect(normalizeSalesCommercialStatus('')).toBeNull();
    expect(normalizeSalesCommercialStatus('PAGO VALIDADO')).toBeUndefined();
    expect(normalizeSalesCommercialStatus(42)).toBeUndefined();
  });
});
