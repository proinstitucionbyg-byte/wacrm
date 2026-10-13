import { describe, expect, it } from 'vitest';
import { suggestReminder } from './parse';

describe('suggestReminder', () => {
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
});
