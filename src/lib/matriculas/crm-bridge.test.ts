import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
function setup() {
  const context = createContext({});
  runInContext(
    readFileSync('docs/apps-script/PUENTE_CRM_MATRICULAS.gs', 'utf8'),
    context
  );
  runInContext(
    "stored={CRM_BASE_URL:'https://crm.example',CRM_SYNC_KEY:'test'}; CLAVE_=function(v){return String(v||'').normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'');}; PropertiesService={getScriptProperties:function(){return {getProperty:function(k){return stored[k];},getProperties:function(){return stored;},setProperty:function(k,v){stored[k]=v;},deleteProperty:function(k){delete stored[k];}};}}; V2={admin:'admin'}; SpreadsheetApp={openById:function(){return {getSheetByName:function(){return null;}};}};",
    context
  );
  runInContext("C_SINCRONIZAR_CUADRO_=function(){};", context);
  runInContext("C_RECONCILIAR_HOJA_CRM_=function(){};", context);
  return (code: string) => runInContext(code, context);
}

describe('manual enrollment welcome status', () => {
  it('does not restore an old NO REALIZADO snapshot over a concurrent human REALIZADO edit', () => {
    const run=setup();
    run("actual=Array(30).fill('');actual[22]='REALIZADO';snapshot=Array(30).fill('');snapshot[22]='NO REALIZADO';snapshot[6]='ESTUDIANTE';writes=[];sheet={getRange:function(row,col,n,w){return {setValues:function(values){writes.push([col,w]);values[0].forEach(function(v,i){actual[col-1+i]=v;});},getValue:function(){return actual[col-1];},getFormula:function(){return '';},setValue:function(v){actual[col-1]=v;}};}};C_ESCRIBIR_FILA_SIN_ESTADO_(sheet,3,snapshot,23,false);");
    expect(run('actual[22]')).toBe('REALIZADO');
    expect(run('actual[6]')).toBe('ESTUDIANTE');
    expect(JSON.parse(JSON.stringify(run('writes')))).toEqual([[1,22],[24,7]]);
  });
  it('initializes only a new blank state, preserving existing and concurrently selected states', () => {
    const run=setup();
    run("state='';sheet={getRange:function(){return {setValues:function(){},getValue:function(){return state;},getFormula:function(){return '';},setValue:function(v){state=v;}};}};C_ESCRIBIR_FILA_SIN_ESTADO_(sheet,3,Array(30).fill(''),23,true);");
    expect(run('state')).toBe('NO REALIZADO');
    run("state='REALIZADO';C_ESCRIBIR_FILA_SIN_ESTADO_(sheet,3,Array(30).fill(''),23,true);");
    expect(run('state')).toBe('REALIZADO');
    run("state='';C_ESCRIBIR_FILA_SIN_ESTADO_(sheet,3,Array(30).fill(''),23,false);");
    expect(run('state')).toBe('');
  });
});
describe('puente Google CRM', () => {
  it('records a paid incomplete intake without changing adviser-owned state or requiring documents', () => {
    const run = setup();
    run("headers=['N°','FECHA DE HOY','HORA','INSTITUTO','ASESORA DE INGRESO','ASESORA DE VTAS.','NOMBRE COMPLETO','TIPO DE DOCUMENTO','NUMERO DE DOCUMENTO','F. NACIMIENTO','EDAD','CELULAR 1','CELULAR 2','DIRECCION','DEPARTAMENTO','DISTRITO','CORREO ELECTRONICO','LINK DE CARPETA DEL ESTUDIANTE','CURSO','FECHA DE INICIO','AGREGADOS AL WHATSAPP','PRIORIDAD','ESTADO','PROMO','OBSERVACIONES','OBSERVACION PARA FIDELIZACION','OBSERVACION PARA VENTAS','ID DE INICIO','ID MATRICULA CRM','NUMERO DE OPERACION'];map={};headers.forEach(function(x,i){map[x]=i+1;});existing=Array(30).fill('');existing[4]='ANTONELLA';existing[22]='REALIZADO';existing[24]='NOTA MANUAL';job={id:'case',payment_status:'validated',payment_purpose:'enrollment',status:'collecting',operation_reference:'000123',sales_adviser:'INSTITUCION',data:{full_name:'ESTUDIANTE',phone1:'51912345678'}};planned=C_PLAN_FILA_HOJA_(job,map,existing,14,new Date('2026-10-23T20:00:00Z'));again=C_PLAN_FILA_HOJA_(job,map,planned,15,new Date('2026-10-24T20:00:00Z'));");
    expect(run('planned[0]')).toBe(14);
    expect(run('planned[4]')).toBe('ANTONELLA');
    expect(run('planned[22]')).toBe('REALIZADO');
    expect(run('planned[24]')).toContain('NOTA MANUAL');
    expect(run('planned[24]')).toContain('DOCUMENTOS NO CONFIRMADOS');
    expect(run('planned[29]')).toBe('000123');
    expect(run('JSON.stringify(planned)===JSON.stringify(again)')).toBe(true);
    expect(() => run("C_PLAN_FILA_HOJA_(Object.assign({},job,{payment_status:'pending'}),map,existing,14,new Date())")).toThrow('NO ELEGIBLE');
    expect(() => run("C_PLAN_FILA_HOJA_(Object.assign({},job,{payment_purpose:'other'}),map,existing,14,new Date())")).toThrow('NO ELEGIBLE');
    expect(() => run("C_PLAN_FILA_HOJA_(Object.assign({},job,{data:{phone1:'+51 987 020 644'}}),map,existing,14,new Date())")).toThrow('NO ELEGIBLE');
  });
  it('appends after the last student rather than after the prefilled institute rows', () => {
    const run = setup();
    run("rows=Array.from({length:184},function(_,i){const row=Array(30).fill('');row[3]='INSTICRECE';if(i<5)row[6]='ESTUDIANTE '+i;return row;});");
    expect(run('C_SIGUIENTE_FILA_CON_DATOS_(rows,[],[],3)')).toBe(7);
  });
  it('preserves a reserved CRM row and any later manual value, formula or note', () => {
    const run = setup();
    expect(run("C_SIGUIENTE_FILA_CON_DATOS_([['','','','INSTICRECE'],['','','','','CRM RESERVADO']],[],[],3)")).toBe(4);
    expect(run("C_SIGUIENTE_FILA_CON_DATOS_([['','','','INSTICRECE']],[['=IF(TRUE,\"\",\"\")']],[],3)")).toBe(3);
    expect(run("C_SIGUIENTE_FILA_CON_DATOS_([['','','','INSTICRECE']],[],[['NOTA MANUAL']],3)")).toBe(3);
    expect(run('C_SIGUIENTE_FILA_CON_DATOS_([],[],[],3)')).toBe(2);
  });
  it('preserves adviser dropdown choices while allowing the verified institutional sale', () => {
    const run = setup();
    run("SpreadsheetApp.DataValidationCriteria={VALUE_IN_LIST:'LIST'}; choices=['ASHLY']; saved=null; rule={getCriteriaType:function(){return 'LIST';},getCriteriaValues:function(){return [choices,true];},copy:function(){return {requireValueInList:function(v,show){saved={values:v,show:show};return this;},build:function(){return saved;}};}}; cell={getDataValidation:function(){return rule;},setDataValidation:function(v){saved=v;}}; C_ASESORA_VALIDACION_(cell,'INSTITUCION');");
    expect(Array.from(run('saved.values'))).toEqual(['ASHLY','INSTITUCION']);
    expect(Array.from(run('choices'))).toEqual(['ASHLY']);
    expect(run('saved.show')).toBe(true);
  });
  it('normalizes operation references and rejects a second enrollment row', () => {
    const run=setup();
    expect(run("C_OPERACION_DUPLICADA_([['OP 00123']],[['another-job']],' op00123 ','current-job')")).toBe(true);
    expect(run("C_OPERACION_DUPLICADA_([['OP 00123']],[['current-job']],'OP00123','current-job')")).toBe(false);
    expect(run("C_OPERACION_DUPLICADA_([['OP 00123']],[['another-job']],'','current-job')")).toBe(false);
  });
  it('does not replace an unrelated adviser validation rule', () => {
    const run = setup();
    run("SpreadsheetApp.DataValidationCriteria={VALUE_IN_LIST:'LIST'}; cell={getDataValidation:function(){return {getCriteriaType:function(){return 'RANGE';}};}};");
    expect(() => run("C_ASESORA_VALIDACION_(cell,'INSTITUCION')")).toThrow('REVISAR VALIDACION');
  });
  it('refuses missing credentials and insecure addresses', () => {
    const run = setup();
    run(
      "PropertiesService={getScriptProperties:function(){return {getProperty:function(k){return k==='CRM_BASE_URL'?'http://example.com':'test';}};}};"
    );
    expect(() => run('C_CONFIG_()')).toThrow('FALTA CONFIGURAR');
  });
  it('does nothing when the queue has no approved enrollment', () => {
    const run = setup();
    run(
      "calls=[]; BLOQUEO_=function(fn){return fn();}; C_API_=function(path){calls.push(path);return {job:null};}; C_REGISTRAR_=function(){throw Error('MUST NOT REGISTER');}; SINCRONIZAR_CRM_MATRICULAS();"
    );
    expect(Array.from(run('calls'))).toEqual(['/claim']);
  });
  it('returns the registration result only after successful registration', () => {
    const run = setup();
    run(
      "calls=[]; BLOQUEO_=function(fn){return fn();}; C_API_=function(path,body){calls.push([path,body]);return {job:{id:'case',lease_token:'lease'}};}; C_REGISTRAR_=function(){return {registered_number:'3',student_folder_url:'folder'};}; SINCRONIZAR_CRM_MATRICULAS();"
    );
    expect(run('calls[1][1].status')).toBe('registered');
    expect(
      run("JSON.parse(stored['CRM DOCUMENTOS:case']).registered_number")
    ).toBe('3');
    expect(run('calls[1][1].registered_number')).toBe('3');
  });
  it('preserves a successful registration for retry after a result timeout', () => {
    const run = setup();
    run(
      "calls=[]; BLOQUEO_=function(fn){return fn();}; C_API_=function(path,body){calls.push([path,body]);if(path.indexOf('result')!==-1)throw Error('NETWORK');return {job:{id:'case',lease_token:'lease'}};}; C_REGISTRAR_=function(){return {registered_number:'3',student_folder_url:'folder'};};"
    );
    expect(() => run('SINCRONIZAR_CRM_MATRICULAS()')).toThrow('NETWORK');
    expect(run('calls.length')).toBe(2);
    expect(run('calls[1][1].status')).toBe('registered');
  });
  it('reports a processing error without claiming registration', () => {
    const run = setup();
    run(
      "calls=[]; BLOQUEO_=function(fn){return fn();}; C_API_=function(path,body){calls.push([path,body]);return {job:{id:'case',lease_token:'lease'}};}; C_REGISTRAR_=function(){throw Error('IDENTIDAD');};"
    );
    expect(() => run('SINCRONIZAR_CRM_MATRICULAS()')).toThrow('IDENTIDAD');
    expect(run('calls[1][1].status')).toBe('error');
  });
  it('reuses the existing original photo instead of copying it again', () => {
    const run = setup();
    run(
      "C_CONFIG_=function(){return {};}; seen=false; folder={getFiles:function(){return {hasNext:function(){return !seen;},next:function(){seen=true;return {getName:function(){return 'VOUCHER-id.jpg';},marker:1};}};}};"
    );
    expect(run("C_FOTO_({},'id',folder,'VOUCHER').marker")).toBe(1);
  });
  it('sends only the three generated PDFs and removes a completed task', () => {
    const run = setup();
    run(
      "stored['CRM DOCUMENTOS:case']=JSON.stringify({lease_token:'lease',status:'registered',registered_number:'3'}); C_CONFIG_=function(){return {base:'https://crm.example',key:'test'};}; C_API_=function(){return {};}; CLAVE_=function(x){return x;}; calls=[]; SpreadsheetApp.openById=function(){return {getSheetByName:function(){return {getLastRow:function(){return 2;},getRange:function(){return {getValues:function(){return [['3','','','','','','','','','','','','https://drive.google.com/file/d/one/view','https://drive.google.com/file/d/two/view','https://drive.google.com/file/d/three/view','GENERADO','']];}};}};}};}; DriveApp={getFileById:function(id){return {getMimeType:function(){return 'application/pdf';},getBlob:function(){return {getBytes:function(){return [1,2,3];}};}};}}; UrlFetchApp={fetch:function(url){calls.push(url);return {getResponseCode:function(){return 200;}};}}; C_ENVIAR_DOCUMENTOS_PENDIENTES_();"
    );
    expect(Array.from(run('calls'))).toEqual(
      ['BOLETA', 'CRONOGRAMA', 'FICHA'].map(
        (kind) =>
          `https://crm.example/api/v1/enrollments/case/documents/${kind}`
      )
    );
    expect(run("stored['CRM DOCUMENTOS:case']")).toBeUndefined();
  });
});
