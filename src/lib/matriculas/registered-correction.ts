import { ENROLLMENT_FIELDS, parseEnrollmentData, type EnrollmentData } from './enrollment';

export type CorrectionScope = 'crm' | 'linked';
type Field = keyof typeof ENROLLMENT_FIELDS;
export type CorrectionTarget = 'crm' | 'sheet' | 'folder' | 'BOLETA' | 'CRONOGRAMA' | 'FICHA' | 'certificates';
export interface CorrectionPlan {
  scope: CorrectionScope;
  changes: { field: Field; label: string; before: string; after: string }[];
  targets: { target: CorrectionTarget; state: 'required' | 'review'; explanation: string }[];
  warnings: string[];
  identityChanged: boolean;
}
const identity: Field[] = ['full_name', 'document_type', 'document_number', 'birth_date'];
const finance: Field[] = ['promotion_id', 'payment_date', 'amount', 'payment_method'];

/** Preview only: never mutates a registered record or asserts remote completion. */
export function planRegisteredCorrection(before: EnrollmentData, rawPatch: unknown, scope: CorrectionScope): CorrectionPlan {
  if (scope !== 'crm' && scope !== 'linked') throw Error('Selecciona dónde corregir los datos.');
  if (!rawPatch || typeof rawPatch !== 'object' || Array.isArray(rawPatch)) throw Error('Corrección inválida.');
  const patch = rawPatch as Record<string, unknown>;
  const fields = Object.keys(patch);
  if (!fields.length || fields.some(key => !Object.hasOwn(ENROLLMENT_FIELDS, key))) throw Error('Solo se pueden corregir los campos de la ficha; los respaldos conservan su historial.');
  const parsed = parseEnrollmentData({ ...before, ...patch });
  if (!parsed) throw Error('Revisa los datos corregidos.');
  const changes = (fields as Field[]).flatMap(field => {
    const old = before[field] ?? '', next = parsed[field] ?? '';
    if (old === next) return [];
    if (!next && !['phone2', 'address', 'department', 'district'].includes(field)) throw Error(`No puedes dejar vacío: ${ENROLLMENT_FIELDS[field]}.`);
    return [{ field, label: ENROLLMENT_FIELDS[field], before: old, after: next }];
  });
  if (!changes.length) throw Error('No hay cambios para aplicar.');
  const changed = (keys: Field[]) => changes.some(change => keys.includes(change.field));
  const identityChanged = changed(identity);
  const targets: CorrectionPlan['targets'] = [{ target: 'crm', state: 'required', explanation: 'Actualizar la ficha conservando su número e historial.' }];
  const warnings: string[] = [];
  if (scope === 'crm') {
    warnings.push('Solo cambia la ficha del CRM. La hoja, carpeta y documentos conservarán los datos anteriores.');
  } else {
    targets.push({ target: 'sheet', state: 'required', explanation: 'Actualizar la misma fila por su ID de matrícula; no crear otra matrícula.' });
    if (changed(['full_name', 'document_number', 'document_type'])) targets.push({ target: 'folder', state: 'required', explanation: 'Revisar y actualizar la carpeta existente, conservando su enlace.' });
    for (const target of ['BOLETA', 'CRONOGRAMA', 'FICHA'] as const) targets.push({ target, state: target === 'BOLETA' ? 'review' : 'required', explanation: target === 'BOLETA' ? 'Revisar el comprobante emitido y el procedimiento de corrección. No asignar otro correlativo ni reemplazar el original automáticamente.' : 'Generar una revisión y conservar el archivo anterior con su historial.' });
    if (identityChanged || changed(['course'])) targets.push({ target: 'certificates', state: 'review', explanation: 'Localizar certificados ya emitidos de este estudiante y curso. Corregirlos solo después de verificar identidad, archivo y numeración; no emitir un certificado nuevo por cambiar un dato.' });
    warnings.push('Generar un archivo corregido no confirma que haya sido enviado. La entrega debe mostrar su propio estado.');
  }
  if (identityChanged) warnings.push('La confirmación anterior de identidad no acredita automáticamente los datos corregidos. Hace falta revisarlos de nuevo.');
  if (changed(finance)) warnings.push('Cambiar importes, promoción o datos de pago requiere revisar el pago validado y la oferta; este cambio no valida un pago.');
  if (changed(['course', 'start_date'])) warnings.push('Comprobar curso e inicio oficial en el calendario antes de actualizar hojas o documentos.');
  return { scope, changes, targets, warnings, identityChanged };
}
