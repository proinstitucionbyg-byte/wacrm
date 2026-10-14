import { describe, expect, it } from 'vitest';
import { suggestReminder } from './parse';

describe('suggestReminder', () => {
  it('reconoce 11 y media de la noche como 23:30', () => {
    expect(suggestReminder('Recuérdame hoy a las 11 y media de la noche', new Date(2026, 9, 14, 10)).dueLocal)
      .toBe('2026-10-14T23:30');
  });
  const now = new Date(2026, 9, 12, 10, 0);

  it('recognizes tomorrow afternoon', () => {
    expect(suggestReminder('Recuérdame mañana a las 3 de la tarde', now).dueLocal)
      .toBe('2026-10-13T15:00');
  });

  it('recognizes daily repetition', () => {
    expect(suggestReminder('Recuérdame cada día a las 2 de la tarde', now).repeatDays).toBe(1);
  });

  it('requests a number for vague repetition', () => {
    expect(suggestReminder('Recuérdame cada unos días', now).needsInterval).toBe(true);
  });

  it('fills an exact date, time and interval from dictation', () => {
    const result = suggestReminder('Recuérdame el 20 de octubre a las 3 de la tarde cada 2 semanas llamar a Luis', now);
    expect(result.dueLocal).toBe('2026-10-20T15:00');
    expect(result.repeatDays).toBe(14);
  });

  it('recognizes a numeric date and relative timing', () => {
    expect(suggestReminder('Avisar el 25/10/2026 a las 14:30', now).dueLocal).toBe('2026-10-25T14:30');
    expect(suggestReminder('Avisar en 2 horas', now).dueLocal).toBe('2026-10-12T12:00:00');
  });

  it('recognizes pasado manana and a month from now', () => {
    expect(suggestReminder('Recuérdame pasado mañana a las 2 de la tarde', now).dueLocal)
      .toBe('2026-10-14T14:00');
    expect(suggestReminder('Recuérdame dentro de un mes', now).dueLocal)
      .toBe('2026-11-12T10:00:00');
  });

  it('schedules spoken relative minutes at the exact second', () => {
    const nowWithSeconds = new Date(2026, 9, 14, 1, 21, 48);
    expect(suggestReminder('Quiero que me recuerdes en dos minutos que tengo que tomar agua.', nowWithSeconds).dueLocal)
      .toBe('2026-10-14T01:23:48');
    expect(suggestReminder('Recordar en 25 minutos llamar', nowWithSeconds).dueLocal)
      .toBe('2026-10-14T01:46:48');
    expect(suggestReminder('En veinticinco minutos tomar agua', nowWithSeconds).dueLocal)
      .toBe('2026-10-14T01:46:48');
  });

  it('does not silently set 9 am when no time was dictated', () => {
    expect(suggestReminder('Tomar agua', now).dueLocal).toBe('');
  });
});
