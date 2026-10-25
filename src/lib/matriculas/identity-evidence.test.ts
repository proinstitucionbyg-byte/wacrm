import { describe,expect,it } from 'vitest';
import { declarationEvidence } from './identity-evidence';
import { prepareAutomaticIntake } from './auto-intake';
import { collectEnrollmentData } from './collect-data';
import { enrollmentIssues,isMinor,parseEnrollmentData } from './enrollment';
const id='11111111-1111-4111-8111-111111111111';
const data={full_name:'LUIS TEST',document_number:'12345678',email:'test@gmail.com'};
const message={id,sender_type:'customer',content_text:'NOMBRE: LUIS TEST\nDNI: 12345678\nCORREO: test@gmail.com'};
describe('identidad con respaldo escrito y tutor',()=>{
  it('retains the original IDs for a bulleted compound name and split DNI with email in another message',()=>{
    const fields={full_name:'ANA ISABEL TORRES GONZALES DE GARCIA',document_number:'12345678',email:'ana@example.com'};
    const written=[
      {id,sender_type:'customer',content_text:'- Ana Isabel Torres Gonzales de Garcia\n- DNI\n- 12345678\n- 24/08/1966'},
      {id:'22222222-2222-4222-8222-222222222222',sender_type:'customer',content_text:fields.email},
    ];
    const result=prepareAutomaticIntake(fields,written,[],'2026-10-25T12:00:00Z');
    expect(result.declaration_message_ids).toEqual(written.map(message=>message.id));
    expect(result.identity_confirmed).not.toBe(true);
    expect(declarationEvidence(fields,[...written,{id:'third',content_text:'DNI: 87654321'}])).toEqual([]);
  });
  it('conserva solo declaraciones completas y concordantes',()=>{
    expect(declarationEvidence(data,[message])).toEqual([id]);
    expect(declarationEvidence(data,[{...message,content_text:'NOMBRE: LUIS TEST\nDNI: 12345678'}])).toEqual([]);
    expect(declarationEvidence(data,[message,{...message,id:'other',content_text:'DNI: 87654321'}])).toEqual([]);
  });
  it('acepta nombre, documento y correo escritos en mensajes separados',()=>{
    const values={full_name:'MARIELA HAYDEE LUGONES LOAYZA',document_number:'70249409',email:'persona@example.com'};
    const written=[
      {id:'11111111-1111-4111-8111-111111111111',sender_type:'customer',content_text:values.full_name},
      {id:'22222222-2222-4222-8222-222222222222',sender_type:'customer',content_text:values.document_number},
      {id:'33333333-3333-4333-8333-333333333333',sender_type:'customer',content_text:values.email},
    ];
    expect(declarationEvidence(values,written)).toHaveLength(3);
  });
  it('la excepcion no marca una foto verificada',()=>{
    const prepared=prepareAutomaticIntake(data,[message],[],'2026-10-09T12:00:00Z');
    expect(prepared.declaration_message_ids).toEqual([id]);expect(prepared.identity_confirmed).not.toBe(true);
    expect(enrollmentIssues(prepared)).not.toContain('VERIFICAR IDENTIDAD: SELECCIONAR FOTO O RESPALDO ESCRITO COMPLETO');
  });
  it('una foto contradictoria no se evade con la declaracion',()=>{
    const photo={id:'photo',sender_type:'customer',content_text:null,image_analysis:{category:'identity_document',fields:{full_name:'OTRA PERSONA',document_number:'12345678'}}};
    expect(prepareAutomaticIntake(data,[message,photo],[],'2026-10-09T12:00:00Z').declaration_message_ids).toEqual([]);
  });
  it('no mezcla el documento del tutor con el del estudiante',()=>{
    const photo={id,sender_type:'customer',content_text:'DOCUMENTO DEL TUTOR',image_analysis:{category:'identity_document',fields:{full_name:'PADRE TEST',document_number:'87654321'}}};
    expect(collectEnrollmentData(data,[photo])).toMatchObject({...data,guardian_message_ids:[id]});
  });
  it('solicita documento del tutor antes de los 18 y no el dia de cumpleanos',()=>{
    expect(isMinor('2008-10-10',new Date('2026-10-09T23:00:00-05:00'))).toBe(true);
    expect(isMinor('2008-10-09',new Date('2026-10-09T00:00:00-05:00'))).toBe(false);
    expect(enrollmentIssues({birth_date:'2015-01-01'})).toContain('SOLICITAR DNI DEL TUTOR O PADRES');
    expect(enrollmentIssues({birth_date:'2015-01-01',guardian_message_ids:[id]})).not.toContain('SOLICITAR DNI DEL TUTOR O PADRES');
  });
  it('valida y conserva identificadores sin ampliar acceso a otros archivos',()=>{
    expect(parseEnrollmentData({declaration_message_ids:[id],guardian_message_ids:[id]})?.declaration_message_ids).toEqual([id]);
    expect(parseEnrollmentData({guardian_message_ids:['wrong']})).toBeNull();
  });
});
