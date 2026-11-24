import { describe, expect, it } from 'vitest';
import { planRegisteredCorrection } from './registered-correction';
const before = {full_name:'PIERO PALACIOS',document_type:'DNI',document_number:'23018826',email:'prueba@example.com'};
describe('registered correction impact preview',()=>{
 it('normalizes a correction and limits CRM-only scope explicitly',()=>{
  const p=planRegisteredCorrection(before,{full_name:' Piero   Palacios Corregido '},'crm');
  expect(p.changes[0]).toMatchObject({before:'PIERO PALACIOS',after:'PIERO PALACIOS CORREGIDO'});
  expect(p.targets.map(x=>x.target)).toEqual(['crm']);expect(p.identityChanged).toBe(true);expect(before.full_name).toBe('PIERO PALACIOS');
 });
 it('lists linked effects without claiming certificate or fiscal reissue',()=>{
  const p=planRegisteredCorrection(before,{full_name:'Nombre corregido'},'linked');
  expect(p.targets.map(x=>x.target)).toEqual(['crm','sheet','folder','BOLETA','CRONOGRAMA','FICHA','certificates']);
  expect(p.targets.filter(x=>x.state==='review').map(x=>x.target)).toEqual(['BOLETA','certificates']);
 });
 it('does not request certificate correction for a contact detail',()=>{
  expect(planRegisteredCorrection(before,{email:'otro@example.com'},'linked').targets.some(x=>x.target==='certificates')).toBe(false);
 });
 it('does not let a patch approve identity, payment or replace evidence',()=>{
  for(const patch of [{identity_confirmed:true},{declaration_message_ids:[]},{status:'registered'},{prices:[1,2,3,4,5,6]}])expect(()=>planRegisteredCorrection(before,patch,'linked')).toThrow();
 });
 it('rejects blank required fields, no-op and invalid values',()=>{
  for(const patch of [{full_name:''},{full_name:before.full_name},{email:25},{}])expect(()=>planRegisteredCorrection(before,patch,'crm')).toThrow();
 });
 it('warns that a financial edit does not validate payment',()=>{
  expect(planRegisteredCorrection(before,{amount:'25'},'linked').warnings.some(x=>x.includes('no valida un pago'))).toBe(true);
 });
});
