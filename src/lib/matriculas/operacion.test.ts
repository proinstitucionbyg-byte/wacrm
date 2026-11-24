import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';
import {describe,it,expect} from 'vitest';
const script=readFileSync('docs/apps-script/MATRICULAS_V2.gs','utf8')+'\n'+readFileSync('docs/apps-script/OPERACION_MATRICULAS.gs','utf8');
function setup(){const context=createContext({});runInContext(script,context);runInContext("DIA_=function(d){return d.toISOString().slice(0,10);};",context);return (source:string)=>runInContext(source,context);}
describe('operacion permanente de listas y cortes docentes',()=>{
  it('reconoce nombres visibles y normalizados del mismo curso',()=>{const run=setup();expect(run("O_CURSO_('NUTRICIÓN Y DIETÉTICA M - J DE 8 - 10 PM')[0]")).toBe('NUTRICION Y DIETETICA');expect(run("O_CURSO_('AUXILIAR DE EDUCACION INICIAL L-M 18-20')[0]")).toBe('EDUCACION INICIAL');});
  it('renueva exactamente cuatro dias despues sin modificar matriculas',()=>{const run=setup();run("filas=[['id','NUTRICION Y DIETETICA','MODULO','2026-10-06','SI'],['id2','NUTRICION Y DIETETICA','SIGUIENTE','2026-11-05','SI']];");expect(run("O_INICIO_VISIBLE_(filas,'NUTRICION Y DIETETICA','2026-10-09')")).toBe('2026-10-06');expect(run("O_INICIO_VISIBLE_(filas,'NUTRICION Y DIETETICA','2026-10-10')")).toBe('2026-11-05');expect(run('filas.length')).toBe(2);});
  it('no muestra inicios ni alumnos de otro curso',()=>{const run=setup();expect(run("O_INICIO_VISIBLE_([],'NUTRICION Y DIETETICA','2026-10-09')")).toBe('');expect(run("O_LISTA_([[1,'FARMACIA','id','2026-10-06','','','51999999999']],'NUTRICION Y DIETETICA','2026-10-06').length")).toBe(0);});
  it('genera cinco columnas y conserva el celular como texto y el estado real del grupo',()=>{const run=setup();expect(run("JSON.stringify(O_LISTA_([[2,'NUTRICION Y DIETETICA','id','2026-10-06','','','00123456789','','','SI']],'NUTRICION Y DIETETICA','2026-10-06')[0].filter(function(x){return !(x instanceof Date);}));")).toBe('[2,"NUTRICION Y DIETETICA","00123456789","SI"]');});
  it('incluye al alumno ya atendido aunque todavia no este agregado a WhatsApp',()=>{
    const run=setup();
    run("source=[['N°','CURSO','ID DE INICIO','FECHA DE INICIO','ASESORA DE INGRESO','NOMBRE COMPLETO','CELULAR 1','CELULAR 2','PRIORIDAD','AGREGADOS AL WHATSAPP','ESTADO'],[12,'AUXILIAR DE FARMACIA M-V DE 6 - 8','id','2026-10-28','A','ALUMNO UNO','00111111111','','ALTA','NO','REALIZADO'],[18,'AUXILIAR DE FARMACIA M-V 18-20','id','2026-10-28','A','ALUMNO DOS','00222222222','','ALTA','','NO REALIZADO']];s={getLastRow:function(){return source.length;},getLastColumn:function(){return source[0].length;},getRange:function(r,c,h,w){return {getValues:function(){return source.slice(r-1,r-1+h).map(function(row){return row.slice(c-1,c-1+w);});}};}};");
    expect(run("JSON.stringify(O_LISTA_(O_ALUMNOS_(s),'AUXILIAR DE FARMACIA','2026-10-28').map(function(r){return [r[0],r[4]];}))")).toBe('[[12,"NO"],[18,""]]');
    expect(run("source[1][10]")).toBe('REALIZADO');
  });
  it('el cambio de cohorte no modifica ni elimina los estados SI/NO guardados en matriculas',()=>{
    const run=setup();run("alumnos=[[1,'AUXILIAR DE FARMACIA','id','2026-10-28','','UNO','001','','','SI'],[2,'AUXILIAR DE FARMACIA','id2','2026-11-25','','DOS','002','','','NO']];original=JSON.stringify(alumnos);");
    run("O_LISTA_(alumnos,'AUXILIAR DE FARMACIA','2026-11-25');");expect(run('JSON.stringify(alumnos)===original')).toBe(true);
    expect(run("O_LISTA_(alumnos,'AUXILIAR DE FARMACIA','2026-10-28')[0][4]")).toBe('SI');
  });
  it('calcula cortes 6-20 y 21-5 incluso al cambiar de ano',()=>{const run=setup();for(const [date,expected] of [['2026-10-09','["2026-10-06","2026-10-20"]'],['2026-10-21','["2026-10-21","2026-11-05"]'],['2027-01-05','["2026-12-21","2027-01-05"]']])expect(run(`JSON.stringify(O_PERIODO_('${date}'))`)).toBe(expected);});
  it('descuenta feriado 8 de octubre de nutricion sin perder sesiones',()=>{const run=setup();expect(run("JSON.stringify(O_CONTEO_('NUTRICION Y DIETETICA','2026-10-06','2026-10-20',[]))")).toBe(JSON.stringify({programadas:['2026-10-06','2026-10-08','2026-10-13','2026-10-15','2026-10-20'],feriados:['2026-10-08'],canceladas:[],previstas:['2026-10-06','2026-10-13','2026-10-15','2026-10-20']}));});
  it('incorpora cancelaciones informadas y futuras por curso',()=>{const run=setup();expect(run("JSON.stringify(O_CANCELACIONES_('ASISTENTE ADMINISTRATIVO',{'CANCELACIONES:ASISTENTE ADMINISTRATIVO':'[\"2026-10-14\"]'}))")).toBe('["2026-10-14","2026-10-07"]');expect(run("O_CONTEO_('ASISTENTE ADMINISTRATIVO','2026-10-06','2026-10-20',['2026-10-07']).previstas.length")).toBe(3);});
  it('rechaza periodos imposibles y duplicados',()=>{const run=setup();expect(()=>run("O_CONTEO_('NUTRICION Y DIETETICA','2026-02-30','2026-03-01',[])")).toThrow();expect(()=>run("O_INICIO_VISIBLE_([['x','NUTRICION Y DIETETICA','','2026-10-06','SI'],['y','NUTRICION Y DIETETICA','','2026-10-06','SI']],'NUTRICION Y DIETETICA','2026-10-06')")).toThrow('DUPLICADOS');});
});
