import type { ChatMessage } from './types';

/** Route academic help from the customer's own words, never from AI guesses. */
export function studentSupportArea(latest: string, messages: ChatMessage[]): 'fidelizacion' | null {
  const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const question = normalize(latest);
  if (/quiero (?:comprar|inscribirme|matricularme)|(?:precio|promocion|informacion).{0,25}(?:otro|nuevo) curso/.test(question)) return null;
  const academic = /(?:mi|mis|la|las) (?:clase|clases|nota|notas|certificado|certificados|grabacion|grabaciones)|(?:link|enlace|acceso).{0,30}(?:clase|aula|plataforma)|(?:no puedo|no me deja).{0,30}(?:ingresar|entrar)|(?:problema|ayuda).{0,30}(?:docente|clase|plataforma)/.test(question);
  const customerHistory = normalize(messages.filter(m => m.role === 'user').map(m => m.content).join('\n'));
  const identifiedStudent = /\bsoy (?:alumn[oa]|estudiante)|\bya (?:estoy matriculad[oa]|me matricule|estudio|estoy estudiando)|\bestoy (?:llevando|estudiando)\b/.test(customerHistory);
  // A new prospect can ask about "mi clase" before enrollment. Do not move
  // them to student support without their own claim of already studying.
  if (academic && identifiedStudent) return 'fidelizacion';
  return null;
}
