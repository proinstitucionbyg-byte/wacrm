import {expect,it} from 'vitest';
import {manualEvidenceIssue,manualEvidenceMatches} from './manual-evidence';
const data={full_name:'ESTUDIANTE DE PRUEBA',document_type:'DNI',document_number:'12345678',email:'prueba@example.com'};
it('requires explicit staff confirmation, origin, phone and real entered identifiers',()=>{
 expect(manualEvidenceIssue(data,'call','51987020644',false)).toBeTruthy();
 expect(manualEvidenceIssue(data,'inventado','51987020644',true)).toBeTruthy();
 expect(manualEvidenceIssue(data,'other_whatsapp','12',true)).toBeTruthy();
 expect(manualEvidenceIssue({...data,email:''},'call','51987020644',true)).toBeTruthy();
 expect(manualEvidenceIssue(data,'call','51987020644',true)).toBeNull();
});
it('invalidates a confirmation after identity fields change, but accepts later nonidentity data',()=>{
 const evidence={category:'staff_confirmed_identity',fields:{...data}};
 expect(manualEvidenceMatches({...data,birth_date:'1990-01-01'},evidence)).toBe(true);
 expect(manualEvidenceMatches({...data,email:'otra@example.com'},evidence)).toBe(false);
 expect(manualEvidenceMatches(data,{category:'identity_document',fields:{...data}})).toBe(false);
});
