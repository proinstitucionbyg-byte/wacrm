import { describe, expect, it } from 'vitest';
import { commandName, isInboxCommand, resolveCommand } from './commands';
describe('prepared adviser commands', () => {
  it('parses a named block without sending literal text', () =>
    expect(commandName(' mandar(MEDIOS DE PAGO) ')).toBe('MEDIOS DE PAGO'));
  it('rejects empty and multiline commands', () => {
    expect(commandName('MANDAR()')).toBeNull();
    expect(commandName('MANDAR(PAGO\nOTRO)')).toBeNull();
  });
  it('intercepts malformed commands too', () => {
    expect(isInboxCommand('MANDAR (')).toBe(true);
    expect(isInboxCommand('Hola')).toBe(false);
  });
  it('matches case and accents without guessing a different promotion', () => {
    const blocks = [{ id: 'one', name: 'PROMOCIÓN 19.90 FARMACIA' }];
    expect(resolveCommand('promocion 19.90 farmacia', blocks)?.id).toBe('one');
    expect(resolveCommand('farmacia', blocks)).toBeNull();
  });
  it('rejects ambiguous duplicate names', () =>
    expect(
      resolveCommand('PAGO', [
        { id: 'one', name: 'PAGO' },
        { id: 'two', name: 'pago' },
      ])
    ).toBeNull());
});
