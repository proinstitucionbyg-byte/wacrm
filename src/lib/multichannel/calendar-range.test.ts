import { describe, expect, it } from 'vitest';
import { simulationCalendarRange } from './calendar-range';

describe('rango del calendario de simulación', () => {
  it('usa el mes completo en hora de Lima, incluyendo el cambio de año', () => {
    expect(simulationCalendarRange('2026-12')).toEqual({
      start: '2026-12-01T05:00:00.000Z', end: '2027-01-01T05:00:00.000Z',
    });
  });
  it('rechaza meses y años malformados', () => {
    for (const value of ['2026-13', '2026-2', '1999-12', '2101-01', 'abc']) {
      expect(() => simulationCalendarRange(value)).toThrow();
    }
  });
});
