import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
function setup() {
  const context = createContext({});
  runInContext(
    readFileSync('docs/apps-script/PUENTE_CRM_MATRICULAS.gs', 'utf8'),
    context
  );
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
});
