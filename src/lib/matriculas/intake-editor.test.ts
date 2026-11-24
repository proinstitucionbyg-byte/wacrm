import { describe, expect, it } from 'vitest';
import {
  intakeEditorStorageKey,
  prepareIntakeDraft,
  sameIntakeData,
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

describe('draft save with updated identity',()=>{
 it('detaches only the outdated declaration and never mutates its stored reference',()=>{const old={full_name:'NOMBRE ANTERIOR',email:'prueba@example.com',declaration_message_ids:['evidence-old']};const edit={...old,full_name:'NOMBRE CORREGIDO'};const result=prepareIntakeDraft(edit,old);expect(result.declaration_message_ids).toEqual([]);expect(result.identity_confirmed).toBe(false);expect(old.declaration_message_ids).toEqual(['evidence-old']);expect(edit.declaration_message_ids).toEqual(['evidence-old']);});
 it('keeps the confirmation when only the course changes',()=>{const old={full_name:'NOMBRE DE PRUEBA',declaration_message_ids:['proof']};const edit={...old,course:'CURSO NUEVO'};expect(prepareIntakeDraft(edit,old)).toBe(edit);});
 it('preserves a newly obtained confirmation for the corrected data',()=>{const old={full_name:'NOMBRE ANTERIOR',declaration_message_ids:['old']};const edit={full_name:'NOMBRE CORREGIDO',declaration_message_ids:['new']};expect(prepareIntakeDraft(edit,old)).toBe(edit);});
 it('requires reviewing a photo again when the name changes without deleting it',()=>{const old={full_name:'NOMBRE ANTERIOR',identity_message_ids:['photo'],identity_confirmed:true};expect(prepareIntakeDraft({...old,full_name:'OTRO NOMBRE'},old)).toMatchObject({identity_message_ids:['photo'],identity_confirmed:false});});
 it('compares saved data independently from JSON key ordering',()=>{expect(sameIntakeData({email:'a@b.com',course:'CURSO'},{course:'CURSO',email:'a@b.com'})).toBe(true);expect(sameIntakeData({course:'A'},{course:'B'})).toBe(false);});
});
