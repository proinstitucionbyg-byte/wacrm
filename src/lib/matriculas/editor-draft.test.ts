import { describe, expect, it } from 'vitest';
import { restoreEnrollmentEditorData } from './editor-draft';

describe('restoreEnrollmentEditorData', () => {
  it('recovers only locally changed fields while keeping newer server data', () => {
    const baseData = { full_name: 'Ana', email: 'before@example.com', phone1: '1' };
    const data = { ...baseData, email: 'correct@example.com' };
    const current = { ...baseData, phone1: '2' };
    expect(restoreEnrollmentEditorData(current, JSON.stringify({ baseData, data, savedAt: 100 }), 200))
      .toEqual({ data: { full_name: 'Ana', email: 'correct@example.com', phone1: '2' }, restored: true });
  });

  it('ignores old and malformed drafts', () => {
    const current = { full_name: 'Ana' };
    expect(restoreEnrollmentEditorData(current, '{bad', 200)).toEqual({ data: current, restored: false });
    expect(restoreEnrollmentEditorData(current, JSON.stringify({ baseData: current, data: { full_name: 'Eva' }, savedAt: 1 }), 90_000_000))
      .toEqual({ data: current, restored: false });
  });
});
