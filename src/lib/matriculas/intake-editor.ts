import { ENROLLMENT_FIELDS, type EnrollmentData } from './enrollment';

export type EnrollmentField = keyof typeof ENROLLMENT_FIELDS;

export interface IntakeEditorDraft {
  intakeId: string;
  baseVersion: number;
  data: EnrollmentData;
  confirmedFields: string[];
  editedFields?: (keyof EnrollmentData)[];
}

/** Reapply only fields the operator edited over a newer server snapshot. */
export function rebaseIntakeEditorData(
  serverData: EnrollmentData,
  localData: EnrollmentData,
  editedFields: (keyof EnrollmentData)[]
): EnrollmentData {
  const rebased = { ...serverData };
  for (const field of editedFields) {
    const value = localData[field];
    if (value !== undefined) Object.assign(rebased, { [field]: value });
  }
  return rebased;
}

/** Keep the fields that were missing when the editor opened visible until save. */
export function visibleIntakeFields(
  initialFields: EnrollmentField[]
): EnrollmentField[] {
  return initialFields;
}

export function readIntakeEditorDraft(
  raw: string | null,
  intakeId: string,
  version: number
): IntakeEditorDraft | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<IntakeEditorDraft>;
    if (
      value.intakeId !== intakeId ||
      value.baseVersion !== version ||
      !value.data ||
      typeof value.data !== 'object' ||
      !Array.isArray(value.confirmedFields)
    ) return null;
    return {
      intakeId,
      baseVersion: version,
      data: value.data,
      editedFields: Array.isArray(value.editedFields)?value.editedFields.filter((field):field is keyof EnrollmentData=>typeof field==='string'&&field in value.data!):undefined,
      confirmedFields: value.confirmedFields.filter((field): field is string => typeof field === 'string'),
    };
  } catch {
    return null;
  }
}

export function intakeEditorStorageKey(intakeId: string): string {
  return `wacrm:intake-editor:${intakeId}`;
}

/** Saving a draft may detach an outdated confirmation; it never deletes the evidence file. */
export function prepareIntakeDraft(data:EnrollmentData,previous:EnrollmentData):EnrollmentData{
 const normalize=(field:string,value:unknown)=>String(value??'').trim().replace(/\s+/g,' ').toLocaleUpperCase('es');
 const changed=(fields:string[])=>fields.some(field=>normalize(field,data[field as keyof EnrollmentData])!==normalize(field,previous[field as keyof EnrollmentData]));
 const sameOldDeclaration=!!data.declaration_message_ids?.length&&data.declaration_message_ids.every(id=>previous.declaration_message_ids?.includes(id));
 const staleDeclaration=sameOldDeclaration&&changed(['full_name','document_type','document_number','email']);
 const stalePhoto=!!data.identity_confirmed&&!!data.identity_message_ids?.length&&changed(['full_name','document_type','document_number']);
 if(!staleDeclaration&&!stalePhoto)return data;
 return {...data,...(staleDeclaration?{declaration_message_ids:[]}:{}),identity_confirmed:false};
}
export function sameIntakeData(left:EnrollmentData,right:EnrollmentData){
 return (Object.keys({...left,...right}) as (keyof EnrollmentData)[]).every(key=>JSON.stringify(left[key])===JSON.stringify(right[key]));
}
