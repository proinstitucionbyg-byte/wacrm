import { ENROLLMENT_FIELDS, type EnrollmentData } from './enrollment';

export type EnrollmentField = keyof typeof ENROLLMENT_FIELDS;

export interface IntakeEditorDraft {
  intakeId: string;
  baseVersion: number;
  data: EnrollmentData;
  confirmedFields: string[];
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
      confirmedFields: value.confirmedFields.filter((field): field is string => typeof field === 'string'),
    };
  } catch {
    return null;
  }
}

export function intakeEditorStorageKey(intakeId: string): string {
  return `wacrm:intake-editor:${intakeId}`;
}
