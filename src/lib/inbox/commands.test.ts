import { describe, expect, it } from 'vitest';
import { commandName, isInboxCommand, resolveCommand } from './commands';
describe('prepared adviser commands', () => {
  it.each(['mandar(medios de pago)', 'MANDAR ( medios de pago )', ' mandar   (Yape o Plin) '])('accepts the requested command syntax: %s', (text) => {
    const name = commandName(text);
    expect(name).not.toBeNull();
    expect(resolveCommand(name!, [{id:'payment',name:'YAPE O PLIN'},{id:'bank',name:'CUENTAS BANCARIAS'},{id:'after',name:'CONTINUACION DESPUES DEL PAGO'}])?.id).toBe('payment');
  });
  it('does not choose between duplicate payment aliases', () => {
    expect(resolveCommand('medio de pago', [{id:'one',name:'YAPE O PLIN'},{id:'two',name:'YAPE Y PLIN'}])).toBeNull();
  });
  it.each([
    ['nutricion y dietetica', 'NUTRICION'], ['auxiliar de farmacia','FARMACIA'],
    ['recursos humanos','RECURSOS'], ['asistente administrativo','ASISTENTE'],
    ['auxiliar de educacion inicial','EDUCACION'],
  ])('resolves the existing promotion and curriculum blocks for %s', (course, prefix) => {
    const blocks = ['NUTRICION','FARMACIA','RECURSOS','ASISTENTE','EDUCACION'].flatMap((name) => [
      {id:name,name:`${name} 19.90`}, {id:`malla-${name}`,name:`MALLAS DE ${name === 'ASISTENTE' ? 'ADMIN' : name}`},
    ]);
    expect(resolveCommand(`promocion de 19.90 del curso ${course}`,blocks)?.id).toBe(prefix);
    expect(resolveCommand(`malla curricular de ${course}`,blocks)?.id).toBe(`malla-${prefix}`);
  });
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
