import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACCOUNT, phone, sheetDate, planEnrollments, planAppend } from './enrollment-plan.mjs';

function fixture() {
  const id='11111111-1111-4111-8111-111111111111', contact='22222222-2222-4222-8222-222222222222', review='33333333-3333-4333-8333-333333333333';
  const folder='https://drive.google.com/drive/folders/test-folder';
  const row=['1','24/10/2026','13:00:00','INSTICRECE','ASESORA','INSTITUCION','ALUMNA EJEMPLO','DNI','00123456','01/06/1998',28,'+51 999 111 222','','','','','test@example.org',folder,'CURSO EJEMPLO','19/10/2026','','','REALIZADO'];
  const headers=Array(23).fill(''); headers[6]='NOMBRE COMPLETO';headers[22]='ESTADO';
  const documents=Array(17).fill(''); documents[0]='1';documents[9]='20';documents[10]='25/10/2026';documents[11]='B-001';documents[15]='GENERADO';
  for(let i=12;i<=14;i++)documents[i]=`https://drive.google.com/file/d/test-${i}/view`;
  const docHeaders=Array(17).fill('');docHeaders[12]='BOLETA PDF';
  return {matriculas:{values:[headers,row]},documents:{values:[docHeaders,documents]},enrollments:[{id,account_id:ACCOUNT,contact_id:contact,review_id:review,status:'registered',payment_status:'validated',payment_purpose:'enrollment',registered_number:'1',student_folder_url:folder,contact_created_at:'2026-10-24T01:00:00Z',updated_at:'2026-10-25T18:00:00Z',reviewed_by:'human-reviewer',reviewed_at:'2026-10-24T20:00:00Z',data:{full_name:'ALUMNA EJEMPLO',document_type:'DNI',document_number:'00123456',phone1:'999111222',email:'test@example.org',birth_date:'1998-06-01',start_date:'2026-10-19',payment_date:'2026-10-24',payment_method:'YAPE',prices:[19.9,49.9,49.9,49.9,49.9,49.9],amount:'20.00'},deliveries:[{kind:'BOLETA',status:'review'}]}]};
}
test('keeps leading zeros, validated overpayment, human welcome and uncertain delivery',()=>{
  const p=planEnrollments(fixture());
  assert.deepEqual(Object.fromEntries(Object.entries(p.tables).map(([k,v])=>[k,v.length])),{ALUMNOS:1,MATRICULAS:1,PAGOS:1,DOCUMENTOS:3});
  assert.equal(p.tables.ALUMNOS[0][4],'00123456');
  assert.equal(p.tables.PAGOS[0][4],20);
  assert.equal(p.tables.MATRICULAS[0][8],19.9);
  assert.equal(p.tables.MATRICULAS[0][16],'Realizado');
  assert.equal(p.tables.DOCUMENTOS[0][9],'Observado');
  assert.match(p.tables.DOCUMENTOS[0][13],/Entrega por revisar/);
  assert.equal(p.tables.DOCUMENTOS[0][10],'');
  assert.equal(p.tables.DOCUMENTOS[1][9],'Generado');
  assert.equal(p.tables.ALUMNOS[0][9],'');
  assert.equal(p.tables.MATRICULAS[0][9],'');
});
test('dates use Lima calendar date and reject invalid dates',()=>{
  assert.equal(sheetDate('2026-10-24T01:00:00Z'),sheetDate('23/10/2026'));
  assert.equal(sheetDate('1/6/1998'),sheetDate('1998-06-01'));
  assert.throws(()=>sheetDate('6-1-1998'));
  assert.throws(()=>sheetDate('31/02/2026'));
});
test('normalizes Peru prefixes without changing international digits',()=>{
  assert.equal(phone('+51 999 111 222'),phone('999111222'));
  assert.equal(phone('+34 612 345 678'),'34612345678');
  assert.throws(()=>phone('123'));
});
test('does not approve an unvalidated payment or turn another payment purpose into enrollment',()=>{
  const s=fixture();s.enrollments[0].payment_status='pending';assert.throws(()=>planEnrollments(s),/no elegible/);
  s.enrollments[0].payment_status='validated';s.enrollments[0].payment_purpose='tuition';assert.throws(()=>planEnrollments(s),/no elegible/);
});
test('rejects wrong account, mismatched identity and mismatched paid amount',()=>{
  const s=fixture();s.enrollments[0].account_id='other';assert.throws(()=>planEnrollments(s),/cuenta/);
  s.enrollments[0].account_id=ACCOUNT;s.matriculas.values[1][8]='99999999';assert.throws(()=>planEnrollments(s),/Conflicto/);
  s.matriculas.values[1][8]='00123456';s.documents.values[1][9]=19.9;assert.throws(()=>planEnrollments(s),/Monto/);
});
test('requires existing generated documents and preserves a missing delivery as unconfirmed',()=>{
  const s=fixture();s.documents.values[1][12]='';assert.throws(()=>planEnrollments(s),/enlace/);
  s.documents.values[1][12]='https://drive.google.com/file/d/file/view';s.enrollments[0].deliveries=[];
  assert.equal(planEnrollments(s).tables.DOCUMENTOS[0][9],'Generado');
});
test('a sent reservation alone is not confirmed delivery; Meta receipts are required',()=>{
  const s=fixture();s.enrollments[0].deliveries=[{kind:'BOLETA',status:'sent',sent_at:'2026-10-25T18:00:00Z'}];
  let p=planEnrollments(s);assert.equal(p.tables.DOCUMENTOS[0][9],'Generado');assert.equal(p.tables.DOCUMENTOS[0][11],'');
  s.enrollments[0].deliveries[0].message_status='read';
  p=planEnrollments(s);assert.equal(p.tables.DOCUMENTOS[0][9],'Entregado');assert.equal(p.tables.DOCUMENTOS[0][11],'');
  s.enrollments[0].deliveries[0].delivered_at='2026-10-25T18:01:00Z';
  assert.equal(planEnrollments(s).tables.DOCUMENTOS[0][11],sheetDate('2026-10-25'));
  assert.deepEqual(p.tables.DOCUMENTOS.map(r=>r[4]),['Boleta','Cronograma','Ficha matrícula']);
});
test('rerunning does not append duplicates and refuses to overwrite human edits',()=>{
  const rows=planEnrollments(fixture()).tables.ALUMNOS;
  assert.deepEqual(planAppend(rows,rows),[]);
  const edited=structuredClone(rows);edited[0][17]='Nota humana';
  assert.throws(()=>planAppend(edited,rows),/existentes diferentes/);
  assert.throws(()=>planAppend([],rows.concat(rows)),/duplicado/);
});
test('same phone does not merge different people',()=>{
  const s=fixture(), e=structuredClone(s.enrollments[0]);
  e.id='44444444-4444-4444-8444-444444444444';e.contact_id='55555555-5555-4555-8555-555555555555';e.review_id='66666666-6666-4666-8666-666666666666';e.registered_number='2';e.data.full_name='OTRA ALUMNA';e.data.document_number='11234567';
  const row=structuredClone(s.matriculas.values[1]);row[0]='2';row[6]=e.data.full_name;row[8]=e.data.document_number;
  const docs=structuredClone(s.documents.values[1]);docs[0]='2';
  s.enrollments.push(e);s.matriculas.values.push(row);s.documents.values.push(docs);
  assert.equal(planEnrollments(s).tables.ALUMNOS.length,2);
  e.data.document_number='00123456';row[8]='00123456';assert.throws(()=>planEnrollments(s),/Documento repetido/);
});
test('one person can have two enrollments without duplicating their profile',()=>{
  const s=fixture(),e=structuredClone(s.enrollments[0]);e.id='44444444-4444-4444-8444-444444444444';e.review_id='66666666-6666-4666-8666-666666666666';e.registered_number='2';
  const row=structuredClone(s.matriculas.values[1]);row[0]='2';const docs=structuredClone(s.documents.values[1]);docs[0]='2';
  s.enrollments.push(e);s.matriculas.values.push(row);s.documents.values.push(docs);
  const p=planEnrollments(s);assert.equal(p.tables.ALUMNOS.length,1);assert.equal(p.tables.MATRICULAS.length,2);
  assert.deepEqual(p.tables,planEnrollments({...s,enrollments:[...s.enrollments].reverse()}).tables);
});
