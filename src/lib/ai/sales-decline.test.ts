import { describe, expect, it } from 'vitest';
import { isExplicitSalesDecline } from './sales-decline';

describe('explicit sales refusal', () => {
  it('stops an unambiguous refusal', () => {
    expect(isExplicitSalesDecline('no estoy interesada, gracias')).toBe(true);
    expect(isExplicitSalesDecline('No deseo más información')).toBe(true);
    expect(isExplicitSalesDecline('Por favor no me escriban')).toBe(true);
  });
  it('keeps an objection or a course change available for a response', () => {
    expect(isExplicitSalesDecline('Está caro, no sé')).toBe(false);
    expect(isExplicitSalesDecline('No estoy interesada en farmacia pero sí en nutrición')).toBe(false);
    expect(isExplicitSalesDecline('No quiero pagar ahora')).toBe(false);
  });
});
