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
  it('recognizes a promotion with course aliases and typing mistakes', () => {
    const blocks = [{ id: 'promo', name: 'ASISTENTE 19.90' }, { id: 'malla', name: 'MALLAS DE ADMIN' }, { id: 'other', name: 'FARMACIA 19.90' }];
    expect(resolveCommand('super promod e asistentae administrayvo', blocks)?.id).toBe('promo');
    expect(resolveCommand('malla curricular de asistente administrativo', blocks)?.id).toBe('malla');
    expect(resolveCommand('super promo de auxiliar de farmacia', blocks)?.id).toBe('other');
    expect(resolveCommand('promo de nutricion', blocks)).toBeNull();
  });
  it('requires an exact amount when specified and never guesses between offers', () => {
    const blocks = [{ id: 'one', name: 'FARMACIA 19.90' }, { id: 'two', name: 'FARMACIA 39.90' }];
    expect(resolveCommand('promo farmacia', blocks)).toBeNull();
    expect(resolveCommand('promo 19.90 farmacia', blocks)?.id).toBe('one');
    expect(resolveCommand('promo 29.90 farmacia', blocks)).toBeNull();
  });
});
