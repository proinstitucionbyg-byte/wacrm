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
  it('does not guess a name when written name and OCR disagree', () => {
    expect(collectEnrollmentData({}, [front]).full_name).toBeUndefined();
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
