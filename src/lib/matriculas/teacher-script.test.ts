import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
function fixture() {
  const ctx=createContext({console});
  runInContext(readFileSync('docs/apps-script/MATRICULAS_V2.gs','utf8'),ctx);
  runInContext(readFileSync('docs/apps-script/DOCENTES_CRM.gs','utf8'),ctx);
  runInContext(`
    store={}; notes={};colors={};changes=[];
    PropertiesService={getScriptProperties:function(){return {getProperty:k=>store[k],getProperties:()=>store,setProperty:(k,v)=>{store[k]=v;},deleteProperty:k=>delete store[k]};}};
    Utilities={formatDate:function(d){return new Date(d.getTime()-5*3600000).toISOString().slice(0,10);}};
    rows=[['','NUTRICION Y DIETETICA - MARTES Y JUEVES : 8 - 10 PM'],...Array.from({length:6},(_,i)=>['',i+1,'MODULO '+(i+1),'','','','','',i===0?new Date('2026-11-05T12:00:00-05:00'):i===5?new Date('2026-10-06T12:00:00-05:00'):'']),['','ACTIVO']];
    sheet={getLastRow:()=>rows.length,getRange:function(r,c,n,w){return {getValues:()=>rows,getValue:()=>rows[r-1][c-1],getNote:()=>notes[r]||'',setValue:function(v){rows[r-1][c-1]=v;changes.push(r);return this;},setNumberFormat:function(){return this;},setFontColor:function(v){colors[r]=v;return this;},setNote:function(v){notes[r]=v;return this;},clearNote:function(){delete notes[r];return this;}};}};
    HOJA_=()=>sheet;LEER_CUADROS_INICIOS_=()=>{};RESALTAR_CUADROS_INICIOS_=()=>{};SpreadsheetApp={flush:()=>{}};
  `,ctx);
  return (code:string)=>runInContext(code,ctx);
}
describe('Google: reprogramaciones de docentes',()=>{
  it('salta la clase cancelada y cambia el siguiente inicio sin perder ocho clases',()=>{
    const run=fixture();run(`D_APLICAR_({id:'case',course:'NUTRICION Y DIETETICA',class_date:'2026-10-13'});`);
    expect(run("DIA_(rows[1][8])")).toBe('2026-11-10');
    expect(run("DIA_(rows[6][8])")).toBe('2026-10-06');
    expect(run("JSON.parse(store['CANCELACIONES:NUTRICION Y DIETETICA - MARTES Y JUEVES : 8 - 10 PM'])")).toContain('2026-10-13');
    expect(run('notes[2]')).toContain('2026-11-10');
  });
  it('un reintento no añade otro aplazamiento',()=>{
    const run=fixture();run(`job={id:'case',course:'NUTRICION Y DIETETICA',class_date:'2026-10-13'};D_APLICAR_(job);D_APLICAR_(job);`);
    expect(run('changes.length')).toBe(2);
    expect(run("DIA_(rows[1][8])")).toBe('2026-11-10');
  });
  it('la primera clase cancelada desplaza el inicio y soporta recuperación sin marcador',()=>{
    const run=fixture();run(`job={id:'first',course:'NUTRICION Y DIETETICA',class_date:'2026-10-06'};D_APLICAR_(job);delete store['DOCENTE APLICADO:first'];D_APLICAR_(job);`);
    // Oct 8 is a holiday. The next class is Oct 13.
    expect(run('DIA_(rows[6][8])')).toBe('2026-10-13');
    expect(run('DIA_(rows[1][8])')).toBe('2026-11-10');
  });
  it('retira solo el aviso propio al vencer tres días, conservando la fecha',()=>{
    const run=fixture();run(`D_APLICAR_({id:'case',course:'NUTRICION Y DIETETICA',class_date:'2026-10-13'});store['DOCENTE AVISO:2']=JSON.stringify({expires:0,date:'2026-11-10'});D_LIMPIAR_AVISOS_();`);
    expect(run('notes[2]')).toBeUndefined();
    expect(run('DIA_(rows[1][8])')).toBe('2026-11-10');
    expect(run('colors[2]')).toBe('#000000');
  });
});
