import {describe,it,expect} from 'vitest';
import {previewEnrollmentIntake} from './intake-preview';
import {missingRequiredEnrollmentFields} from './enrollment';
import type {AcademicModule} from './calendar';
const calendar:AcademicModule[]=[{course:'ASISTENTE ADMINISTRATIVO',module:'NEGOCIACION',start_date:'2026-11-27',class_dates:['2026-11-27','2026-12-02','2026-12-04','2026-12-09','2026-12-11','2026-12-16','2026-12-18','2026-12-23'],hour:'20:00'}];
describe('intake view from known evidence',()=>{
 it('asks only what is still missing and separates payment date from module start',()=>{
 const original={phone1:'51987654321'};const next=previewEnrollmentIntake(original,{amount:20,date:'17/11/2026',institution:'BCP'},[{id:'written',sender_type:'customer',content_text:'Nombres: Ana Isabel Perez Torres\nDNI: 12345678\nCorreo: ana@example.com\nCurso: Asistente Administrativo'}],calendar,'2026-11-17T20:00:00Z');
 expect(next).toMatchObject({full_name:'ANA ISABEL PEREZ TORRES',payment_date:'2026-11-17',start_date:'2026-11-27',amount:'20.00'});
 expect(missingRequiredEnrollmentFields(next)).not.toContain('full_name');expect(missingRequiredEnrollmentFields(next)).not.toContain('start_date');expect(missingRequiredEnrollmentFields(next)).toContain('birth_date');expect(original).toEqual({phone1:'51987654321'});
 });
 it('preserves manually supplied dates and amounts',()=>{const next=previewEnrollmentIntake({course:'ASISTENTE ADMINISTRATIVO',start_date:'2026-12-02',payment_date:'2026-11-16',amount:'19.90'},{amount:20,date:'17/11/2026'},[],calendar,'2026-11-17T20:00:00Z');expect(next).toMatchObject({start_date:'2026-12-02',payment_date:'2026-11-16',amount:'19.90'});});
});
