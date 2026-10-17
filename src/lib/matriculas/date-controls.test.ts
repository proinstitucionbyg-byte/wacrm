import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';
import {describe,it,expect} from 'vitest';
function setup(){
  const properties:Record<string,string>={},cells:Record<string,unknown>={'7:9':new Date('2026-10-14T12:00:00-05:00')};
  const records=[{row:5,numero:3,titulo:'RECURSOS HUMANOS',nombre:'ANTERIOR',dia:''},{row:7,numero:4,titulo:'RECURSOS HUMANOS',nombre:'ACTUAL',dia:'2026-10-19'},{row:9,numero:5,titulo:'RECURSOS HUMANOS',nombre:'SIGUIENTE',dia:'2026-11-16'},{row:11,numero:6,titulo:'RECURSOS HUMANOS',dia:''},{row:13,numero:1,titulo:'RECURSOS HUMANOS',dia:''},{row:15,numero:2,titulo:'RECURSOS HUMANOS',dia:''}];
  function range(row:number,column:number){const key=`${row}:${column}`;const r={getValue:()=>cells[key]??'',setValue:(v:unknown)=>{cells[key]=v;return r},setNote:()=>r,setBackground:()=>r,setWrap:()=>r,setNumberFormat:()=>r};return r;}
  const s={getRange:range,getParent:()=>({toast:()=>{}})};
  const p={getProperties:()=>properties,getProperty:(k:string)=>properties[k]??null,setProperty:(k:string,v:string)=>properties[k]=v,deleteProperty:(k:string)=>delete properties[k]};
  const ctx=createContext({Date,PropertiesService:{getScriptProperties:()=>p},DIA_:(v:Date)=>v.toISOString().slice(0,10),TEXTO_:(v:unknown)=>String(v??'').trim(),s,records,HOJA_:()=>s,RENOVAR_CUADROS_INICIOS_:()=>{},O_ACTUALIZAR_WHATSAPP_:()=>{},C_SINCRONIZAR_CUADRO_:()=>{}});
  runInContext(readFileSync('docs/apps-script/CONTROL_FECHAS_INICIOS.gs','utf8'),ctx);
  runInContext('F_BLOQUES_=function(){return records;};F_FORMATOS_=function(){};',ctx);
  return {properties,cells,run:(code:string)=>runInContext(code,ctx),edit:(col:number)=>{ctx.e={range:{getSheet:()=>s,getRow:()=>7,getLastRow:()=>8,getColumn:()=>col,getLastColumn:()=>col}};runInContext('F_EDITAR_(e)',ctx);}};
}
describe('fixed date controls',()=>{
  it('interprets day/month/year and rejects invalid dates',()=>{const h=setup();expect(h.run("F_FECHA_('19-10-2026')")).toBe('2026-10-19');expect(h.run("F_FECHA_('31/02/2026')")).toBeNull();});
  it('requires the reason before changing the official date',()=>{const h=setup();h.properties['FECHA BASE:7']='2026-10-14';h.cells['7:9']=new Date('2026-10-19T12:00:00-05:00');h.edit(9);expect((h.cells['7:9'] as Date).toISOString().slice(0,10)).toBe('2026-10-14');expect(h.properties['FECHA PENDIENTE:7']).toContain('2026-10-19');h.cells['7:12']='Reprogramacion por el docente';h.edit(12);expect((h.cells['7:9'] as Date).toISOString().slice(0,10)).toBe('2026-10-19');expect(h.properties['FECHA CAMBIO:7']).toContain('Reprogramacion por el docente');expect(h.properties['FECHA PENDIENTE:7']).toBeUndefined();});
  it('does not require a reason for changing only the date format',()=>{const h=setup();h.properties['FECHA BASE:7']='2026-10-14';h.edit(9);expect(h.properties['FECHA PENDIENTE:7']).toBeUndefined();});
  it('recovers the preceding module from history, not the superseded date of the moved module',()=>{const h=setup();h.properties['CICLO:RECURSOS HUMANOS:2026']=JSON.stringify([{numero:3,dia:'2026-09-16'},{numero:4,dia:'2026-10-14'}]);h.run("F_RECUPERAR_VIGENTE_(s,new Date('2026-10-17T12:00:00-05:00'))");expect((h.cells['5:9'] as Date).toISOString().slice(0,10)).toBe('2026-09-16');expect(h.properties['FECHA FUTURA:RECURSOS HUMANOS:5']).toBe('2026-11-16');});
  it('refuses to invent a preceding date when no history exists',()=>{const h=setup();expect(()=>h.run("F_RECUPERAR_VIGENTE_(s,new Date('2026-10-17T12:00:00-05:00'))")).toThrow('FALTA HISTORIAL');});
});
