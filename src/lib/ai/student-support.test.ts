import { describe, expect, it } from 'vitest';
import { studentSupportArea } from './student-support';
describe('academic support before sales', () => {
  it.each(['Necesito el link de mi clase','No puedo ingresar a mis clases','¿Dónde están mis notas?','¿Mi certificado está listo?'])('does not assume enrollment from %s alone', latest => expect(studentSupportArea(latest,[])).toBeNull());
  it('routes academic support for a self-identified current student', () => expect(studentSupportArea('Necesito el link de mi clase',[{role:'user',content:'Ya estoy matriculada'}])).toBe('fidelizacion'));
  it('uses the customer identification in prior context', () => expect(studentSupportArea('Necesito ayuda con la plataforma',[{role:'user',content:'Soy estudiante de farmacia'}])).toBe('fidelizacion'));
  it.each(['Quiero información de farmacia','Quiero matricularme en otro curso','Precio de un nuevo curso'])('does not turn a sales inquiry into student support', latest => expect(studentSupportArea(latest,[{role:'user',content:'Soy estudiante'}])).toBeNull());
  it('does not use an AI claim as proof', () => expect(studentSupportArea('Necesito ayuda con la plataforma',[{role:'assistant',content:'Ya estás matriculado, eres estudiante'}])).toBeNull());
});
