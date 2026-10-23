import type { EnrollmentData } from './enrollment';
import { ENROLLMENT_FIELDS } from './enrollment';

const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function restoreEnrollmentEditorData(
  current: EnrollmentData,
  raw: string | null,
  now = Date.now()
): { data: EnrollmentData; restored: boolean; confirmedMissing: (keyof typeof ENROLLMENT_FIELDS)[] } {
  if (!raw) return { data: current, restored: false, confirmedMissing: [] };
  try {
    const saved = JSON.parse(raw) as {
      baseData?: EnrollmentData;
      data?: EnrollmentData;
      confirmedMissing?: unknown;
      savedAt?: number;
    };
    if (
      !saved.baseData ||
      !saved.data ||
      typeof saved.savedAt !== 'number' ||
      saved.savedAt > now ||
      now - saved.savedAt > MAX_AGE_MS
    ) return { data: current, restored: false, confirmedMissing: [] };
    const data = { ...current };
    let restored = false;
    for (const key of Object.keys(saved.data) as (keyof EnrollmentData)[]) {
      if (JSON.stringify(saved.data[key]) === JSON.stringify(saved.baseData[key])) continue;
      Object.assign(data, { [key]: saved.data[key] });
      restored = true;
    }
    const confirmedMissing = Array.isArray(saved.confirmedMissing)
      ? saved.confirmedMissing.filter((key): key is keyof typeof ENROLLMENT_FIELDS => typeof key === 'string' && Object.hasOwn(ENROLLMENT_FIELDS, key))
      : [];
    return { data, restored: restored || confirmedMissing.length > 0, confirmedMissing };
  } catch {
    return { data: current, restored: false, confirmedMissing: [] };
  }
}
