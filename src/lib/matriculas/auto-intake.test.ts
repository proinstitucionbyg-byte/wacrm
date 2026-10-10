import { describe, expect, it } from 'vitest';
import { prepareAutomaticIntake, type IntakeEvidence } from './auto-intake';
import { academicOffer, courseKey, type AcademicModule } from './calendar';
const calendar: AcademicModule[] = [{ course: 'NUTRICION Y DIETETICA', module: 'CLINICA', start_date: '2026-10-06', class_dates: ['2026-10-06','2026-10-13','2026-10-15','2026-10-20','2026-10-22','2026-10-27','2026-10-29','2026-11-03'], hour: '20:00' }, { course: 'NUTRICION Y DIETETICA', module: 'SEGURIDAD', start_date: '2026-11-05', class_dates: ['2026-11-05','2026-11-10','2026-11-12','2026-11-17','2026-11-19','2026-11-24','2026-11-26','2026-12-01'], hour: '20:00' }];
const evidence: IntakeEvidence[] = [{ id:'text',sender_type:'customer',content_text:'NOMBRE: LUIS PALACIOS\nDNI: 12345678' }, { id:'photo',sender_type:'customer',content_text:null,image_analysis:{category:'identity_document',fields:{full_name:'LUIS PALACIOS',document_number:'12345678'}} }, { id:'promo',sender_type:'bot',created_at:'2026-10-08T10:00:00Z',content_text:'NUTRICION Y DIETETICA\\nMensualidad: S/79.90\\n1ra Cuota + Matricula: S/*19.90*\\nDuracion: 6 meses' }];
const data = {full_name:'LUIS PALACIOS',document_number:'12345678',course:'NUTRICION Y DIETETICA'};
describe('automatic intake from compared evidence and official dates',()=>{
  it('ignores an electoral code on the reverse while retaining front ID comparison',()=>{
    const reverse: IntakeEvidence={id:'reverse',sender_type:'customer',content_text:null,image_analysis:{category:'identity_document',fields:{document_number:'000379',address:'CALLE UNO'}}};
    expect(prepareAutomaticIntake(data,[...evidence,reverse],calendar,'2026-10-09T12:00:00Z').identity_confirmed).toBe(true);
  });
  it('compares written and photographed data and freezes the written offer',()=>{
    expect(prepareAutomaticIntake(data,evidence,calendar,'2026-10-09T12:00:00Z')).toMatchObject({identity_confirmed:true,offer_confirmed:true,prices:[19.9,79.9,79.9,79.9,79.9,79.9],start_date:'2026-10-06'});
  });
  it('does not confirm identity from a photo alone',()=> expect(prepareAutomaticIntake(data,evidence.slice(1),calendar,'2026-10-09T12:00:00Z').identity_confirmed).not.toBe(true));
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
