import { describe, expect, it } from 'vitest';
import {
  collectEnrollmentData,
  collectPaymentData,
  type IntakeMessage,
} from './collect-data';
const front: IntakeMessage = {
  id: '11111111-1111-4111-8111-111111111111',
  content_text:
    'correo: persona@gmail.com\\ncelular: +51 933 111 222\\nnombre: Claudia Cristina Herrera Dancuart',
  image_analysis: {
    category: 'identity_document',
    fields: {
      full_name: 'CLAUDIA CRISTINA HERRERA DANCAURT',
      document_type: 'DNI',
      document_number: '12345678',
      birth_date: '1998-03-20',
    },
  },
};
const back: IntakeMessage = {
  id: '22222222-2222-4222-8222-222222222222',
  content_text: null,
  image_analysis: {
    category: 'identity_document',
    fields: {
      address: 'CALLE UNO 123',
      district: 'CHORRILLOS',
      department: 'LIMA',
    },
  },
};
describe('deterministic chat intake', () => {
  it('reads WhatsApp labels without a colon and ignores an invalid DNI code from the reverse', () => {
    const value = collectEnrollmentData({}, [
      { id: 'written', content_text: 'Nombre Milena Mileth Pezo Espinoza\nCorreo milena@example.com' },
      { id: 'course', content_text: 'Hola, deseo la Super Promo de 19.90 en Auxiliar de Educación Inicial.' },
      { id: 'front', content_text: null, image_analysis: { category: 'identity_document', fields: { full_name: 'PEZO ESPINOZA MILENA MILETH', document_type: 'DNI', document_number: '52159224', birth_date: '2000-02-02' } } },
      { id: 'back', content_text: null, image_analysis: { category: 'identity_document', fields: { full_name: 'MILENA MILETH PEZO', document_type: 'DNI', document_number: '020026F3512115', department: 'PASCO', district: 'YANACANCHA' } } },
    ]);
    expect(value).toMatchObject({ full_name: 'MILENA MILETH PEZO ESPINOZA', email: 'milena@example.com', course: 'AUXILIAR DE EDUCACION INICIAL', document_type: 'DNI', document_number: '52159224' });
  });
  it('uses the latest requested identity batch instead of mixing earlier OCR attempts', () => {
    const value = collectEnrollmentData({full_name:'NOMBRE ANTERIOR INCORRECTO',document_type:'DNI',document_number:'62179224',identity_message_ids:['old-front']}, [
      { id: 'old-email', created_at: '2026-10-20T06:46:00Z', content_text: 'Correo anterior@example.com' },
      { id: 'old-front', created_at: '2026-10-20T06:47:00Z', content_text: null, image_analysis: { category: 'identity_document', fields: { full_name: 'MILENA MILETH PEZO ESPINOZA', document_type: 'DNI', document_number: '62179224' } } },
      { id: 'name', created_at: '2026-10-20T07:09:00Z', content_text: 'Nombre Milena Mileth Pezo Espinoza' },
      { id: 'email', created_at: '2026-10-20T07:10:00Z', content_text: 'Correo correcto@example.com' },
      { id: 'front', created_at: '2026-10-20T07:10:00Z', content_text: null, image_analysis: { category: 'identity_document', fields: { full_name: 'PEZO ESPINOZA MILENA MILETH', document_type: 'DNI', document_number: '52159224' } } },
    ]);
    expect(value).toMatchObject({ full_name: 'MILENA MILETH PEZO ESPINOZA', email: 'correcto@example.com', document_number: '52159224' });
    expect(value.identity_message_ids).toEqual(['front']);
  });
  it('uses the readable address from the reverse of the latest DNI',()=>{
    const value=collectEnrollmentData({address:'DIRECCION ANTERIOR',department:'OTRO',district:'OTRO'},[
      {id:'written',created_at:'2026-10-20T17:02:00Z',content_text:'Distrito: SAN JUAN DE MIRAFLORES'},
      {id:'back',created_at:'2026-10-20T17:02:43Z',content_text:null,image_analysis:{category:'identity_document',fields:{full_name:'MORALES BAZAN ESKEYLA ALINA',document_type:'DNI',document_number:'73354819',address:'PUEBLO J 28 DE JULIO MZ. M LT. 9',department:'LIMA',district:'HUARAL/CHANCAY'}}},
    ]);
    expect(value).toMatchObject({address:'PUEBLO J 28 DE JULIO MZ. M LT. 9',department:'LIMA',district:'HUARAL/CHANCAY'});
  });
  it('uses the complete front name and the reverse address from the same DNI batch',()=>{
    const value=collectEnrollmentData({},[
      {id:'front',created_at:'2026-10-20T17:02:16Z',content_text:null,image_analysis:{category:'identity_document',fields:{full_name:'MORALES BAZAN, ESKEYLA ALINA',document_type:'DNI',document_number:'73354819'}}},
      {id:'back',created_at:'2026-10-20T17:02:43Z',content_text:null,image_analysis:{category:'identity_document',fields:{full_name:'MORALES ESKEYLA ALINA',document_type:'DNI',document_number:'73354819',address:'PUEBLO J 28 DE JULIO MZ. M LT. 9'}}},
    ]);
    expect(value).toMatchObject({full_name:'ESKEYLA ALINA MORALES BAZAN',document_number:'73354819',address:'PUEBLO J 28 DE JULIO MZ. M LT. 9'});
  });
  it('reads a bare name line and Documento with a dot from a resent data block',()=>{
    const value=collectEnrollmentData({},[
      {id:'text',created_at:'2026-10-20T17:34:16Z',content_text:'Milena mileth Pezo Espinoza\nDocumento.62179224\nCorreo\nmilenamilethpezoespinoza0@gmail.com'},
      {id:'front',created_at:'2026-10-20T17:34:42Z',content_text:null,image_analysis:{category:'identity_document',fields:{full_name:'PEZO ESPINOZA MILENA MILETH',document_type:'DNI',document_number:'62179224'}}},
    ]);
    expect(value).toMatchObject({full_name:'MILENA MILETH PEZO ESPINOZA',document_type:'DNI',document_number:'62179224',email:'milenamilethpezoespinoza0@gmail.com'});
  });
  it('does not replace the holder document with an electoral code from the reverse',()=>{
    const reverse={...back,image_analysis:{category:'identity_document',fields:{...back.image_analysis?.fields,document_type:'Constancia de sufragio',document_number:'000379'}}};
    const value=collectEnrollmentData({},[{...front,content_text:null},reverse]);
    expect(value.document_number).toBe('12345678');
    expect(value.document_type).toBe('DNI');
    expect(value.address).toBe('CALLE UNO 123');
  });
  it('extracts labelled caption data, both DNI faces, course and promotion without approval', () => {
    const sameName = {
      ...front,
      image_analysis: {
        ...front.image_analysis,
        fields: {
          ...front.image_analysis?.fields,
          full_name: 'CLAUDIA CRISTINA HERRERA DANCUART',
        },
      },
    };
    const data = collectEnrollmentData({ phone1: '51987000000' }, [
      sameName,
      back,
      { id: 'text', content_text: 'nutricion es el curso que quiero' },
      {
        id: 'promo',
        content_text: 'me estoy inscribiendo con la super promo de nutricion',
      },
    ]);
    expect(data).toMatchObject({
      full_name: 'CLAUDIA CRISTINA HERRERA DANCUART',
      document_type: 'DNI',
      document_number: '12345678',
      birth_date: '1998-03-20',
      email: 'persona@gmail.com',
      phone2: '+51933111222',
      address: 'CALLE UNO 123',
      district: 'CHORRILLOS',
      department: 'LIMA',
      course: 'NUTRICION Y DIETETICA',
      promotion_id: 'SUPER PROMO DE NUTRICION',
      identity_message_ids: [front.id, back.id],
    });
    expect(data.identity_confirmed).toBeUndefined();
    expect(data.offer_confirmed).toBeUndefined();
    expect(data.start_date).toBeUndefined();
    expect(data.prices).toBeUndefined();
  });
  it('keeps the written name provisionally when OCR disagrees without confirming identity', () => {
    const result = collectEnrollmentData({}, [front]);
    expect(result.full_name).toBe('CLAUDIA CRISTINA HERRERA DANCUART');
    expect(result.identity_confirmed).toBeUndefined();
  });
  it('reads a separate written name, course and email but ignores questions as names', () => {
    const result = collectEnrollmentData({}, [
      { id: '1', content_text: 'Auxiliar de educación inicial' },
      { id: '2', content_text: 'Cómo hago para inscribirme al curso' },
      { id: '3', content_text: 'Ana Maria Perez Torres' },
      { id: '4', content_text: '12345678\nana.perez@example.com' },
      { id: '5', content_text: 'Soy mayor de edad' },
    ]);
    expect(result.course).toBe('AUXILIAR DE EDUCACION INICIAL');
    expect(result.full_name).toBe('ANA MARIA PEREZ TORRES');
    expect(result.email).toBe('ana.perez@example.com');
  });
  it('keeps the written name that matches the DNI when chat phrases resemble names', () => {
    const result = collectEnrollmentData({}, [
      { id: 'chat-1', content_text: 'sigamos con la inscripción' },
      { id: 'chat-2', content_text: 'ahí está el voucher' },
      { id: 'name', content_text: 'Mariela Haydee Lugones Loayza' },
      {
        id: 'dni',
        content_text: null,
        image_analysis: {
          category: 'identity_document',
          fields: {
            full_name: 'MARIELA HAYDEE LUGONES LOAYZA',
            document_number: '70249409',
          },
        },
      },
    ]);
    expect(result.full_name).toBe('MARIELA HAYDEE LUGONES LOAYZA');
  });
  it('preserves manual corrections and confirmed flags', () => {
    const data = {
      full_name: 'CORREGIDO',
      email: 'otro@gmail.com',
      identity_confirmed: true,
      offer_confirmed: true,
    };
    expect(collectEnrollmentData(data, [front])).toMatchObject(data);
  });
  it('never uses a voucher recipient as the student', () => {
    expect(
      collectEnrollmentData({}, [
        {
          id: 'receipt',
          content_text: null,
          image_analysis: {
            category: 'payment_receipt',
            fields: { full_name: 'BENEFICIARIO', document_number: '12345678' },
          },
        },
      ])
    ).toEqual({});
  });
  it('adds the back photo received later and is idempotent', () => {
    const one = collectEnrollmentData({}, [front]);
    const two = collectEnrollmentData(one, [front, back]);
    expect(two.identity_message_ids).toEqual([front.id, back.id]);
    expect(collectEnrollmentData(two, [front, back])).toEqual(two);
  });
  it('does not choose between several courses or turn an information question into a choice', () => {
    for (const content_text of [
      'quiero farmacia o nutricion',
      'informacion de farmacia?',
      'no quiero farmacia',
    ])
      expect(
        collectEnrollmentData({}, [{ id: 'text', content_text }]).course
      ).toBeUndefined();
  });
  it('does not silently remove invalid telephone letters or duplicate the WhatsApp number', () => {
    for (const content_text of [
      'celular: +51 987 000 000',
      'celular: 933 R 111 222',
    ])
      expect(
        collectEnrollmentData({ phone1: '51987000000' }, [
          { id: 'text', content_text },
        ]).phone2
      ).toBeUndefined();
  });
  it('uses a supplied phone for a social student whose channel has no phone number', () => {
    expect(collectEnrollmentData({ phone1: '' }, [{ id: 'text', content_text: 'Celular: 933 691 668' }]).phone1).toBe('933691668');
  });
  it('ambiguous email candidates are left for review', () => {
    expect(
      collectEnrollmentData({}, [
        {
          id: 'text',
          content_text: 'correo: uno@gmail.com\ncorreo: dos@gmail.com',
        },
      ]).email
    ).toBeUndefined();
  });
  it('copies the actual paid amount, date and method without turning the beneficiary into the student', () => {
    expect(
      collectPaymentData(
        {},
        {
          amount: '20',
          date: '05 oct. 2026 01:42 p. m.',
          institution: 'Yape',
          full_name: 'BENEFICIARIO',
        }
      )
    ).toEqual({
      amount: '20.00',
      payment_date: '2026-10-05',
      payment_method: 'YAPE',
    });
  });
  it('does not invent invalid or ambiguous receipt fields and preserves corrections', () => {
    expect(
      collectPaymentData(
        {},
        { amount: 'S/ 20?', date: '31 feb. 2026', institution: 'BANCO' }
      )
    ).toEqual({});
    expect(
      collectPaymentData(
        { amount: '30', payment_date: '2026-10-06', payment_method: 'OTRO' },
        { amount: '20', date: '2026-10-05', institution: 'YAPE' }
      )
    ).toEqual({
      amount: '30',
      payment_date: '2026-10-06',
      payment_method: 'OTRO',
    });
  });
});
