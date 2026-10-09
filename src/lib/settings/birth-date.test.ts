import { describe, expect, it } from 'vitest';
import { isValidBirthDate, todayInLima } from './birth-date';

const now = new Date('2026-10-09T03:00:00Z');
describe('cumpleaños de asesoras', () => {
  it('usa la fecha de Lima aunque UTC ya sea el dia siguiente', () => {
    expect(todayInLima(now)).toBe('2026-10-08');
  });
  it('permite dejar el dato vacio y fechas reales pasadas', () => {
    for (const value of ['', '2000-02-29', '2026-10-08']) {
      expect(isValidBirthDate(value, now)).toBe(true);
    }
  });
  it('rechaza fechas futuras, inexistentes y formatos incorrectos', () => {
    for (const value of ['2026-10-09', '2001-02-29', '2000-02-30', '2000-13-01', '08/10/2000', '0000-01-01']) {
      expect(isValidBirthDate(value, now)).toBe(false);
    }
  });
});
