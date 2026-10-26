import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
const file=new URL('../../docs/apps-script/PUENTE_CENTRAL_CONSULTA.gs',import.meta.url);
function load(extra={}){
  const context=vm.createContext({Date,JSON,console,Utilities:{formatDate:(d)=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Lima',year:'numeric',month:'2-digit',day:'2-digit'}).format(d)},...extra});
  vm.runInContext(readFileSync(file,'utf8'),context);return context;
}
const plain=x=>JSON.parse(JSON.stringify(x));
function tables(){return {ALUMNOS:[['EST-1','contact-1','ALUMNA','DNI','00123456','','','','','','','','','','','','','NOTA HUMANA']],MATRICULAS:[],PAGOS:[],DOCUMENTOS:[]};}
test('repeated batch is a no-op and human edits, delivery and welcome are never overwritten',()=>{
  const c=load(), existing=tables(), incoming=structuredClone(existing);
  incoming.ALUMNOS[0][2]='NOMBRE ORIGEN';incoming.ALUMNOS[0][17]='OBSERVACION AUTOMATICA';
  const before=structuredClone(existing);
  assert.deepEqual(plain(c.VC_APPEND_PLAN_(existing,incoming)),{ALUMNOS:[],MATRICULAS:[],PAGOS:[],DOCUMENTOS:[]});
  assert.deepEqual(existing,before);
});
test('appends only a new stable ID; rerunning after a partial copy adds no duplicates',()=>{
  const c=load(), existing=tables(), incoming=tables();
  const row=incoming.ALUMNOS[0].slice();row[0]='EST-2';row[1]='contact-2';row[4]='11234567';incoming.ALUMNOS.push(row);
  const add=plain(c.VC_APPEND_PLAN_(existing,incoming));assert.equal(add.ALUMNOS.length,1);
  existing.ALUMNOS.push(...add.ALUMNOS);assert.equal(c.VC_APPEND_PLAN_(existing,incoming).ALUMNOS.length,0);
});
test('rejects identity alias, changed immutable relation, duplicate IDs and occupied rows without IDs',()=>{
  const c=load(), original=tables();
  const changed=tables();changed.ALUMNOS[0][0]='EST-OTHER';assert.throws(()=>c.VC_APPEND_PLAN_(original,changed),/MISMO DOCUMENTO/);
  changed.ALUMNOS[0][0]='EST-1';changed.ALUMNOS[0][1]='other-contact';assert.throws(()=>c.VC_APPEND_PLAN_(original,changed),/RELACION/);
  const dup=tables();dup.ALUMNOS.push(dup.ALUMNOS[0]);assert.throws(()=>c.VC_APPEND_PLAN_(dup,tables()),/DUPLICADO/);
  const occupied=tables();occupied.ALUMNOS.push(['','dato manual']);assert.throws(()=>c.VC_APPEND_PLAN_(occupied,tables()),/SIN ID/);
});
test('does not convert typed dates into false readback differences',()=>{
  const c=load();assert.equal(c.VC_VALUES_({getValues:()=>[[new Date('2026-10-25T05:00:00Z')]]})[0][0],46320);
});
test('incomplete pagination and repeated page IDs fail without a write',()=>{
  let requests=0;
  const c=load({C_CONFIG_:()=>({base:'https://personal-wacrm.exjald.easypanel.host',key:'test-only'}),UrlFetchApp:{fetch:()=>{requests++;return {getResponseCode:()=>200,getContentText:()=>JSON.stringify({data:[{id:'one'}],meta:{next_cursor:'same'}})}}}});
  assert.throws(()=>c.VC_JOBS_(),/REPETIDO/);assert.equal(requests,2);
});
test('only uses the expected host and existing API key; no third-party destination',()=>{
  const c=load({C_CONFIG_:()=>({base:'https://other.example',key:'test-only'}),UrlFetchApp:{fetch:()=>assert.fail('must not fetch')}});
  assert.throws(()=>c.VC_JOBS_(),/HOST/);
});
const privateSource=new URL('../../output/centralizacion-2026-10/private/new-two-source.json',import.meta.url);
const privatePlan=new URL('../../output/centralizacion-2026-10/private/reconciled-30-plan.json',import.meta.url);
test('read-only replay of the two reconciled enrollments is idempotent against the current 30-person copy',{skip:!existsSync(privateSource)||!existsSync(privatePlan)},()=>{
  const c=load(), source=JSON.parse(readFileSync(privateSource,'utf8')), current=JSON.parse(readFileSync(privatePlan,'utf8'));
  const apiJobs=structuredClone(source.enrollments).map(e=>{delete e.data.prices;return e;});
  const adapted=c.VC_SOURCE_(apiJobs,source.matriculas.values,source.documents.values);
  const planned=c.VORTEX_PLAN_CORE_.planEnrollments(adapted.source);
  assert.equal(planned.tables.ALUMNOS.length,2);assert.equal(planned.tables.DOCUMENTOS.length,6);
  assert.deepEqual(plain(c.VC_APPEND_PLAN_(current.tables,planned.tables)),{ALUMNOS:[],MATRICULAS:[],PAGOS:[],DOCUMENTOS:[]});
});
