import { describe, expect, it } from 'vitest';
import { normalizeSalesCommercialStatus, SALES_COMMERCIAL_STATUSES } from './commercial-status';

describe('normalizeSalesCommercialStatus', () => {
  it('accepts the supported status labels case-insensitively', () => {
    expect(normalizeSalesCommercialStatus('interesado')).toBe('INTERESADO');
    expect(SALES_COMMERCIAL_STATUSES).toContain('NO INTERESADO-R');
  });

  it('allows clearing a status but rejects unsupported values and types', () => {
    expect(normalizeSalesCommercialStatus(null)).toBeNull();
    expect(normalizeSalesCommercialStatus('')).toBeNull();
    expect(normalizeSalesCommercialStatus('PAGO VALIDADO')).toBeUndefined();
    expect(normalizeSalesCommercialStatus(42)).toBeUndefined();
  });
});
