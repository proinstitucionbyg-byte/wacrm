import { describe, expect, it } from 'vitest';
import { parseReminderDrafts, splitReminderInstructions } from './instructions';

const now = new Date(2026, 9, 14, 1, 0);

describe('reminder dictation', () => {
  it('splits RE and recordatorio markers into separate reminders', () => {
    expect(splitReminderInstructions('RE1 mañana a las 2 llamar. RE2 pasado mañana a las 3 escribir. recordatorio 3 el lunes revisar'))
      .toEqual(['mañana a las 2 llamar.', 'pasado mañana a las 3 escribir.', 'el lunes revisar']);
  });

  it('also separates numbers transcribed as words', () => {
    expect(splitReminderInstructions('recordatorio uno mañana llamar, re dos pasado mañana escribir'))
      .toEqual(['mañana llamar,', 'pasado mañana escribir']);
  });

  it('keeps ordinary speech as one personal reminder', () => {
    const [draft] = parseReminderDrafts('Recuérdame en dos minutos tomar agua', now);
    expect(draft.sendIntent).toBe(false);
    expect(draft.dueLocal).toBe('2026-10-14T01:02:00');
  });

  it('extracts the number and exact outgoing text from spoken send instruction', () => {
    const [draft] = parseReminderDrafts('RE1 quiero que le envíes un mensaje al 987026446 hoy a las 3 de la mañana que Hola, tu clase comienza pronto', now);
    expect(draft.sendIntent).toBe(true);
    expect(draft.destinationPhone).toBe('987026446');
    expect(draft.messageText).toBe('Hola, tu clase comienza pronto');
    expect(draft.dueLocal).toBe('2026-10-14T03:00');
  });

  it('does not silently move an explicitly stated past today to tomorrow', () => {
    const [draft] = parseReminderDrafts('Envíale un mensaje al 987026446 hoy a las 3 de la mañana que Hola', new Date(2026, 9, 14, 4));
    expect(draft.dueLocal).toBe('');
  });
});
