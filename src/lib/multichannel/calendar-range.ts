export type SimulationCalendarRange = { start: string; end: string };

/** Converts a month chosen in Lima into a half-open UTC range for timestamptz queries. */
export function simulationCalendarRange(month: string): SimulationCalendarRange {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!match) throw new Error('Elige un mes válido para consultar el calendario.');
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (year < 2000 || year > 2100) throw new Error('Elige un año entre 2000 y 2100.');
  return {
    start: new Date(Date.UTC(year, monthIndex, 1, 5)).toISOString(),
    end: new Date(Date.UTC(year, monthIndex + 1, 1, 5)).toISOString(),
  };
}
