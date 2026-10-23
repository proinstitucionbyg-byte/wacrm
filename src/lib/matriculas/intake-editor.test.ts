import { describe, expect, it } from 'vitest';
import {
  intakeEditorStorageKey,
  readIntakeEditorDraft,
  rebaseIntakeEditorData,
  visibleIntakeFields,
} from './intake-editor';

describe('inbox enrollment missing-data editor', () => {
  it('keeps the original missing fields visible after selecting DNI', () => {
    const fields = ['document_type', 'document_number'] as const;
    expect(visibleIntakeFields([...fields])).toEqual([...fields]);
  });

  it('restores field values and checked confirmations after a remount at the same server version', () => {
    const draft = {
      intakeId: 'intake-1',
      baseVersion: 4,
      data: { document_type: 'DNI', document_number: '12345678' },
      confirmedFields: ['document_type'],
    };
    expect(readIntakeEditorDraft(JSON.stringify(draft), 'intake-1', 4)).toEqual(draft);
  });

  it('does not apply a local draft to another intake or an updated server version', () => {
    const draft = JSON.stringify({
      intakeId: 'intake-1',
      baseVersion: 4,
      data: { document_number: '12345678' },
      confirmedFields: [],
    });
    expect(readIntakeEditorDraft(draft, 'intake-2', 4)).toBeNull();
    expect(readIntakeEditorDraft(draft, 'intake-1', 5)).toBeNull();
  });

  it('names a separate local draft for each intake', () => {
    expect(intakeEditorStorageKey('intake-1')).not.toBe(intakeEditorStorageKey('intake-2'));
  });

  it('rebases only locally edited fields and preserves newer server fields', () => {
    expect(rebaseIntakeEditorData(
      { full_name: 'MARÍA PÉREZ', phone1: '999111222', email: 'nuevo@correo.pe' },
      { full_name: 'Maria Perez', phone1: '999333444', email: 'anterior@correo.pe' },
      ['full_name', 'phone1'],
    )).toEqual({
      full_name: 'Maria Perez',
      phone1: '999333444',
      email: 'nuevo@correo.pe',
    });
  });

  it('keeps identity evidence and review checkboxes when rebasing a concurrent save', () => {
    expect(rebaseIntakeEditorData(
      { full_name: 'ANDRES RENGIFO', email: 'nuevo@correo.pe' },
      { full_name: 'ANDRES RENGIFO', email: 'nuevo@correo.pe', identity_message_ids: ['photo-1'], identity_confirmed: true },
      ['identity_message_ids', 'identity_confirmed'],
    )).toEqual({
      full_name: 'ANDRES RENGIFO',
      email: 'nuevo@correo.pe',
      identity_message_ids: ['photo-1'],
      identity_confirmed: true,
    });
  });
});
