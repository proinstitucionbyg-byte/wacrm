import { describe, expect, it } from 'vitest';
import { prepareAutomaticIntake, type IntakeEvidence } from './auto-intake';
import { academicOffer, courseKey, type AcademicModule } from './calendar';
const calendar: AcademicModule[] = [{ course: 'NUTRICION Y DIETETICA', module: 'CLINICA', start_date: '2026-10-06', class_dates: ['2026-10-06','2026-10-13','2026-10-15','2026-10-20','2026-10-22','2026-10-27','2026-10-29','2026-11-03'], hour: '20:00' }, { course: 'NUTRICION Y DIETETICA', module: 'SEGURIDAD', start_date: '2026-11-05', class_dates: ['2026-11-05','2026-11-10','2026-11-12','2026-11-17','2026-11-19','2026-11-24','2026-11-26','2026-12-01'], hour: '20:00' }];
const evidence: IntakeEvidence[] = [{ id:'text',sender_type:'customer',content_text:'NOMBRE: LUIS PALACIOS\nDNI: 12345678' }, { id:'photo',sender_type:'customer',content_text:null,image_analysis:{category:'identity_document',fields:{full_name:'LUIS PALACIOS',document_number:'12345678'}} }, { id:'promo',sender_type:'bot',created_at:'2026-10-08T10:00:00Z',content_text:'NUTRICION Y DIETETICA\\nMensualidad: S/79.90\\n1ra Cuota + Matricula: S/*19.90*\\nDuracion: 6 meses' }];
const data = {full_name:'LUIS PALACIOS',document_number:'12345678',course:'NUTRICION Y DIETETICA'};
describe('automatic intake from compared evidence and official dates',()=>{
  it('uses the saved audio offer and ignores the struck-through list price',()=> {
    const caption = {...evidence[2],content_text:'NUTRICION Y DIETETICA\n~Mensualidad: S/79.90~\n1ra Cuota: S/19.90\n6 meses'};
    const audio = {...evidence[2],id:'audio',content_text:'AUDIO ENVIADO: NUTRICION PROMO\nSon seis meses. El primer mes es 19.90 soles y a partir del segundo mes 59.90 soles.'};
    expect(prepareAutomaticIntake(data,[caption,audio],calendar,'2026-10-09T12:00:00Z')).toMatchObject({offer_confirmed:true,prices:[19.9,59.9,59.9,59.9,59.9,59.9]});
    expect(prepareAutomaticIntake(data,[caption],calendar,'2026-10-09T12:00:00Z').offer_confirmed).not.toBe(true);
  });
  it('preserves an already confirmed student offer when a new promotion is sent',()=> {
    const confirmed = {...data,offer_confirmed:true,prices:[19.9,79.9,79.9,79.9,79.9,79.9]};
    expect(prepareAutomaticIntake(confirmed,[{...evidence[2],content_text:evidence[2].content_text!.replace('79.90','49.90')}],calendar,'2026-10-09T12:00:00Z').prices).toEqual(confirmed.prices);
  });
  it('ignores an electoral code on the reverse while retaining front ID comparison',()=>{
    const reverse: IntakeEvidence={id:'reverse',sender_type:'customer',content_text:null,image_analysis:{category:'identity_document',fields:{document_number:'000379',address:'CALLE UNO'}}};
    expect(prepareAutomaticIntake(data,[...evidence,reverse],calendar,'2026-10-09T12:00:00Z').identity_confirmed).toBe(true);
  });
  it('accepts a labelled name without colon and ignores an invalid reverse DNI OCR code',()=>{
    const student={full_name:'MILENA MILETH PEZO ESPINOZA',document_type:'DNI',document_number:'52159224',course:'AUXILIAR DE EDUCACION INICIAL'};
    const messages: IntakeEvidence[]=[
      {id:'written',sender_type:'customer',content_text:'Nombre Milena Mileth Pezo Espinoza'},
      {id:'front',sender_type:'customer',content_text:null,image_analysis:{category:'identity_document',fields:{full_name:'PEZO ESPINOZA MILENA MILETH',document_number:'52159224',birth_date:'2000-02-02'}}},
      {id:'back',sender_type:'customer',content_text:null,image_analysis:{category:'identity_document',fields:{full_name:'MILENA MILETH PEZO',document_number:'020026F3512115',department:'PASCO',district:'YANACANCHA'}}},
    ];
    expect(prepareAutomaticIntake(student,messages,calendar,'2026-10-20T12:00:00Z').identity_confirmed).toBe(true);
  });
  it('compares identity only against the latest requested photo batch',()=>{
    const student={full_name:'MILENA MILETH PEZO ESPINOZA',document_type:'DNI',document_number:'52159224'};
    const messages: IntakeEvidence[]=[
      {id:'old',sender_type:'customer',created_at:'2026-10-20T06:47:00Z',content_text:null,image_analysis:{category:'identity_document',fields:{full_name:'MILENA MILETH PEZO ESPINOZA',document_number:'62179224'}}},
      {id:'name',sender_type:'customer',created_at:'2026-10-20T07:09:00Z',content_text:'Nombre Milena Mileth Pezo Espinoza'},
      {id:'front',sender_type:'customer',created_at:'2026-10-20T07:10:00Z',content_text:null,image_analysis:{category:'identity_document',fields:{full_name:'PEZO ESPINOZA MILENA MILETH',document_number:'52159224'}}},
    ];
    expect(prepareAutomaticIntake(student,messages,calendar,'2026-10-20T12:00:00Z').identity_confirmed).toBe(true);
  });
  it('uses the latest internally consistent promotion block instead of an older campaign',()=>{
    const oldQuote={...evidence[2],created_at:'2026-10-18T10:00:00Z'};
    const latestText={...evidence[2],id:'latest-text',created_at:'2026-10-20T10:00:00Z',content_text:evidence[2].content_text!.replace('79.90','49.90')};
    const latestAudio={...latestText,id:'latest-audio',created_at:'2026-10-20T10:03:00Z'};
    expect(prepareAutomaticIntake(data,[oldQuote,latestText,latestAudio],calendar,'2026-10-20T10:05:00Z')).toMatchObject({offer_confirmed:true,prices:[19.9,49.9,49.9,49.9,49.9,49.9]});
  });
  it('uses the latest payment-promotion image path when its caption is generic',()=>{
    const oldQuote={...evidence[2],created_at:'2026-10-18T20:40:00Z'};
    const latestImage: IntakeEvidence={
      id:'latest-payment-image',sender_type:'bot',created_at:'2026-10-19T13:47:00Z',
      content_text:'TU FORMACION ESTA A SOLO 3 PASOS',
      media_url:'https://example.supabase.co/storage/v1/object/public/media/IMAGENES/CUOTAS%20Y%20PAGOS/PROMO%2049.90/pasos-49.png',
    };
    expect(prepareAutomaticIntake(data,[oldQuote,latestImage],calendar,'2026-10-20T06:43:28Z')).toMatchObject({
      offer_confirmed:true,prices:[19.9,49.9,49.9,49.9,49.9,49.9],
    });
  });
  it('does not infer a promotion from an unrelated media filename',()=>{
    const unrelated: IntakeEvidence={
      id:'unrelated',sender_type:'bot',created_at:'2026-10-19T13:47:00Z',
      content_text:'TU FORMACION ESTA A SOLO 3 PASOS',
      media_url:'https://example.org/imagenes/general/archivo-49.90.png',
    };
    expect(prepareAutomaticIntake(data,[unrelated],calendar,'2026-10-20T06:43:28Z').offer_confirmed).not.toBe(true);
  });
  it('compares written and photographed data and freezes the written offer',()=>{
    expect(prepareAutomaticIntake(data,evidence,calendar,'2026-10-09T12:00:00Z')).toMatchObject({identity_confirmed:true,offer_confirmed:true,prices:[19.9,79.9,79.9,79.9,79.9,79.9],start_date:'2026-10-06'});
  });
  it('does not confirm identity from a photo alone',()=> expect(prepareAutomaticIntake(data,evidence.slice(1),calendar,'2026-10-09T12:00:00Z').identity_confirmed).not.toBe(true));
  it('confirms a consistent physical DNI when both front and reverse are present',()=>{
    const student={...data,full_name:'ESKEYLA ALINA MORALES BAZAN',document_type:'DNI',document_number:'73354819'};
    const front: IntakeEvidence={id:'front',sender_type:'customer',created_at:'2026-10-20T17:02:16Z',content_text:null,image_analysis:{category:'identity_document',fields:{full_name:'MORALES BAZAN, ESKEYLA ALINA',document_number:'73354819'}}};
    const back: IntakeEvidence={id:'back',sender_type:'customer',created_at:'2026-10-20T17:02:43Z',content_text:null,image_analysis:{category:'identity_document',fields:{full_name:'MORALES ESKEYLA ALINA',document_number:'73354819',address:'PUEBLO J 28 DE JULIO'}}};
    expect(prepareAutomaticIntake(student,[front,back],calendar,'2026-10-20T17:03:00Z').identity_confirmed).toBe(true);
  });
  it('uses the latest price-bearing promotion and ignores later informational audios',()=>{
    const promo={...evidence[2],created_at:'2026-10-20T10:00:00Z',content_text:evidence[2].content_text!.replace('79.90','49.90')};
    const info={...evidence[2],id:'info',created_at:'2026-10-20T11:00:00Z',content_text:'[AUDIO ENVIADO: NUTRICION] Información sobre certificación y clases.'};
    expect(prepareAutomaticIntake(data,[promo,info],calendar,'2026-10-20T12:00:00Z')).toMatchObject({offer_confirmed:true,prices:[19.9,49.9,49.9,49.9,49.9,49.9]});
  });
  it('uses the discounted monthly price stated after the regular price in an audio',()=>{
    const audio={...evidence[2],created_at:'2026-10-20T10:00:00Z',content_text:'AUDIO ENVIADO: NUTRICION. La mensualidad regular estaría en 99.90, pero lo estamos dando en 49.90. Tu primer mes tan solo 19.90. La duración viene a ser de seis meses.'};
    expect(prepareAutomaticIntake(data,[audio],calendar,'2026-10-20T12:00:00Z')).toMatchObject({offer_confirmed:true,prices:[19.9,49.9,49.9,49.9,49.9,49.9]});
  });
  it('compares a bare written name with a photo even when the surname order differs', () => {
    const written: IntakeEvidence = { id: 'name', sender_type: 'customer', content_text: 'NANCY MARGOT REYNA RODRIGUEZ' };
    const photo: IntakeEvidence = { id: 'photo', sender_type: 'customer', content_text: null, image_analysis: { category: 'identity_document', fields: { full_name: 'REYNA RODRIGUEZ NANCY MARGOT', document_number: '41326266' } } };
    expect(prepareAutomaticIntake({ full_name: 'NANCY MARGOT REYNA RODRIGUEZ', document_number: '41326266' }, [written, photo], calendar, '2026-10-19T12:00:00Z').identity_confirmed).toBe(true);
  });
  it('compares a bare written name and number against the same photographed document', () => {
    const student = { full_name: 'MARIELA HAYDEE LUGONES LOAYZA', document_number: '70249409' };
    const written: IntakeEvidence[] = [
      { id: 'name', sender_type: 'customer', content_text: student.full_name },
      { id: 'number', sender_type: 'customer', content_text: student.document_number },
    ];
    const photo: IntakeEvidence = { id: 'photo', sender_type: 'customer', content_text: null, image_analysis: { category: 'identity_document', fields: { full_name: student.full_name, document_number: student.document_number } } };
    expect(prepareAutomaticIntake(student, [...written, photo], calendar, '2026-10-19T12:00:00Z').identity_confirmed).toBe(true);
  });
  it('compares accented document labels without discarding document letters',()=>{
    const written = {...evidence[0],content_text:'Nombres y apellidos: LUIS PALACIOS\nCarné de extranjería: AB 123456'};
    const photo = {...evidence[1],image_analysis:{category:'identity_document',fields:{full_name:'LUIS PALACIOS',document_number:'AB123456'}}};
    expect(prepareAutomaticIntake({...data,document_number:'AB123456'},[written,photo],calendar,'2026-10-09T12:00:00Z').identity_confirmed).toBe(true);
    expect(prepareAutomaticIntake({...data,document_number:'123456'},[written,photo],calendar,'2026-10-09T12:00:00Z').identity_confirmed).not.toBe(true);
  });
  it('leaves conflicting identity and promotions for review',()=> {
    const wrong = {...evidence[1],image_analysis:{category:'identity_document',fields:{full_name:'OTRA PERSONA',document_number:'12345678'}}};
    expect(prepareAutomaticIntake(data,[evidence[0],wrong],calendar,'2026-10-09T12:00:00Z').identity_confirmed).not.toBe(true);
    expect(prepareAutomaticIntake(data,[...evidence,{...evidence[2],content_text:evidence[2].content_text!.replace('79.90','39.90')}],calendar,'2026-10-09T12:00:00Z').offer_confirmed).not.toBe(true);
  });
  it('does not use an AI-generated price or a later promotion',()=> {
    expect(prepareAutomaticIntake(data,[{...evidence[2],ai_generated:true}],calendar,'2026-10-09T12:00:00Z').offer_confirmed).not.toBe(true);
    expect(prepareAutomaticIntake(data,[{...evidence[2],created_at:'2026-10-10T00:00:00Z'}],calendar,'2026-10-09T12:00:00Z').offer_confirmed).not.toBe(true);
  });
  it('offers the 13th but registers the official 6th, until the third class begins',()=>{
    expect(academicOffer(calendar,data.course,new Date('2026-10-09T12:00:00-05:00'))).toMatchObject({offered_date:'2026-10-13',start_date:'2026-10-06'});
    expect(academicOffer(calendar,data.course,new Date('2026-10-15T19:59:59-05:00'))?.start_date).toBe('2026-10-06');
    expect(academicOffer(calendar,data.course,new Date('2026-10-15T20:00:00-05:00'))?.start_date).toBe('2026-11-05');
  });
  it('does not invent a date or select between multiple courses',()=>{
    expect(academicOffer([],data.course)).toBeNull();
    expect(courseKey('FARMACIA Y NUTRICION')).toBeNull();
  });
});
