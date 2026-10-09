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
    "stored={CRM_BASE_URL:'https://crm.example',CRM_SYNC_KEY:'test'}; PropertiesService={getScriptProperties:function(){return {getProperty:function(k){return stored[k];},getProperties:function(){return stored;},setProperty:function(k,v){stored[k]=v;},deleteProperty:function(k){delete stored[k];}};}}; V2={admin:'admin'}; SpreadsheetApp={openById:function(){return {getSheetByName:function(){return null;}};}};",
    context
  );
  runInContext("C_SINCRONIZAR_CUADRO_=function(){};", context);
  return (code: string) => runInContext(code, context);
}
describe('puente Google CRM', () => {
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
