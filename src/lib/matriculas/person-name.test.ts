import {describe,it,expect} from 'vitest';
import {isConversationInsteadOfName} from './person-name';
import {collectEnrollmentData,collectPaymentData} from './collect-data';
import {declarationEvidence} from './identity-evidence';
import {enrollmentIssues} from './enrollment';
describe('names and receipt data from actual conversation formats',()=>{
 it('rejects a restart instruction even when evidence was confirmed',()=>{expect(isConversationInsteadOfName('Comenzamos desde CERO')).toBe(true);expect(enrollmentIssues({full_name:'COMENZAMOS DESDE CERO',identity_confirmed:true})).toContain('REVISAR NOMBRE COMPLETO: contiene una frase de conversación; escribe el nombre real del estudiante.');});
 it('does not reject genuine compound names',()=>{for(const name of ['ANA MARIA DE LA CRUZ','PABLO ALBERTO TORRES RIVERA','YA LI ZHANG'])expect(isConversationInsteadOfName(name)).toBe(false);});
 it('reads a name and identifiers from a single explicitly labelled payment declaration',()=>{
 const message={id:'real-written',content_text:'Se realizo el pago de:\nMatricula y 1 Pensión a nombre: Pablo Alberto Torres Rivera - DNI: 12345678 - Celular: 987654321 - Correo electrónico: estudiante@example.com'};
 const data=collectEnrollmentData({full_name:'COMENZAMOS DESDE CERO'},[{id:'restart',content_text:'Comenzamos desde CERO'},message]);
 expect(data).toMatchObject({full_name:'PABLO ALBERTO TORRES RIVERA',document_number:'12345678',email:'estudiante@example.com'});
 expect(declarationEvidence(data,[message])).toEqual(['real-written']);
 });
 it('accepts numeric receipt amounts and an actual payment date without replacing a manual correction',()=>{
 expect(collectPaymentData({},{amount:20,date:'17/11/2026 19:55'})).toMatchObject({amount:'20.00',payment_date:'2026-11-17'});
 expect(collectPaymentData({amount:'19.90',payment_date:'2026-11-16'},{amount:20,date:'17/11/2026'})).toMatchObject({amount:'19.90',payment_date:'2026-11-16'});
 });
});
