import { describe, expect, it } from 'vitest';
import {
  enrollmentIssues,
  parseEnrollmentData,
  suggestIdentityData,
} from './enrollment';
describe('matricula posterior a pago humano', () => {
  it('fills only empty fields from identity OCR and still requires comparison', () => {
    expect(
      suggestIdentityData(
        { full_name: 'NOMBRE ESCRITO', identity_confirmed: true },
        {
          category: 'identity_document',
          fields: {
            full_name: 'OTRO NOMBRE',
            document_number: '12345678',
            birth_date: '2000-01-02',
            address: null,
          },
        }
      )
    ).toEqual({
      full_name: 'NOMBRE ESCRITO',
      identity_confirmed: false,
      document_number: '12345678',
      birth_date: '2000-01-02',
    });
  });
  it('does not turn a receipt payer into the student identity', () => {
    const data = { full_name: 'NOMBRE ESCRITO' };
    expect(
      suggestIdentityData(data, {
        category: 'payment_receipt',
        fields: { full_name: 'PAGADOR' },
      })
    ).toBe(data);
  });
  it('normalizes spaces without silently deleting bad phone letters', () => {
    const data = parseEnrollmentData({
      full_name: 'luis   brayan',
      phone1: '9 37 R 467-119',
      email: ' X@GMAIL.COM ',
    });
    expect(data?.full_name).toBe('LUIS BRAYAN');
    expect(data?.phone1).toBe('937R467119');
    expect(data?.email).toBe('x@gmail.com');
    expect(enrollmentIssues(data!)).toContain('REVISAR CELULAR 1');
  });
  it('requires identity match, files and the specific offered promotion', () => {
    const issues = enrollmentIssues({});
    expect(issues).toContain('COMPARAR NOMBRE Y DOCUMENTO CON SUS FOTOS');
    expect(issues).toContain(
      'CONFIRMAR LA OFERTA DE SEIS CUOTAS QUE RECIBIO EL ESTUDIANTE'
    );
  });
  it('rejects impossible dates and a partial payment without removing validation', () => {
    const issues = enrollmentIssues({
      birth_date: '2026-02-30',
      amount: '20',
      prices: [19.9, 79.9, 79.9, 79.9, 79.9, 79.9],
    });
    expect(issues).toContain('REVISAR FECHA DE NACIMIENTO');
    expect(issues).toContain('PAGO PARCIAL O DISTINTO DE LA OFERTA: REVISAR');
  });
  it('rejects malformed inputs and too many evidence files', () => {
    expect(parseEnrollmentData({ phone1: 123 })).toBeNull();
    expect(parseEnrollmentData({ prices: [19.9] })).toBeNull();
  });
});
