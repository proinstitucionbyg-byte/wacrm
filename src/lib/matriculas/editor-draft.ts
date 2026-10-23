import type { EnrollmentData } from './enrollment';

const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function restoreEnrollmentEditorData(
  current: EnrollmentData,
  raw: string | null,
  now = Date.now()
): { data: EnrollmentData; restored: boolean } {
  if (!raw) return { data: current, restored: false };
  try {
    const saved = JSON.parse(raw) as {
      baseData?: EnrollmentData;
      data?: EnrollmentData;
      savedAt?: number;
    };
    if (
      !saved.baseData ||
      !saved.data ||
      typeof saved.savedAt !== 'number' ||
      saved.savedAt > now ||
      now - saved.savedAt > MAX_AGE_MS
    ) return { data: current, restored: false };
    const data = { ...current };
    let restored = false;
    for (const key of Object.keys(saved.data) as (keyof EnrollmentData)[]) {
      if (JSON.stringify(saved.data[key]) === JSON.stringify(saved.baseData[key])) continue;
      Object.assign(data, { [key]: saved.data[key] });
      restored = true;
    }
    return { data, restored };
  } catch {
    return { data: current, restored: false };
  }
}
