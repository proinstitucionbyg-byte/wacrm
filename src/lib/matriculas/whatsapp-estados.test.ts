import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { describe, it, expect } from 'vitest';
const script = ['MATRICULAS_V2','OPERACION_MATRICULAS','WHATSAPP_ESTADOS'].map(n=>readFileSync(`docs/apps-script/${n}.gs`,'utf8')).join('\n');
function setup() {
  const writes: {sheet:string;row:number;column:number;value:unknown}[]=[];
  const data: Record<string,unknown[][]>={
    MATRICULAS:[['N°','NOMBRE COMPLETO','CURSO','FECHA DE INICIO','AGREGADOS AL WHATSAPP','ESTADO'],[12,'FICTICIO UNO','AUXILIAR DE FARMACIA M-V DE 6 - 8','2026-10-28','NO','REALIZADO'],[18,'FICTICIO DOS','AUXILIAR DE FARMACIA M-V 18-20','2026-10-28','','NO REALIZADO']],
    'WA AUXILIAR DE FARMACIA M-V 18-20':[['INICIO'],['NUMERO','CURSO','FECHA DE INICIO','CELULAR','AGREGADO AL WHATSAPP'],[12,'AUXILIAR DE FARMACIA','2026-10-28','00111111111','NO'],[18,'AUXILIAR DE FARMACIA','2026-10-28','00222222222','']],
  };
  type Sheet={getName:()=>string;getLastRow:()=>number;getLastColumn:()=>number;getMaxColumns:()=>number;getRange:(row:number,column:number,height?:number,width?:number)=>ReturnType<typeof range>};
  const sheets:Record<string,Sheet>={};
  function range(name:string,row:number,column:number,height=1,width=1) {
    return {getSheet:()=>sheets[name],getRow:()=>row,getLastRow:()=>row+height-1,getColumn:()=>column,getLastColumn:()=>column+width-1,getNumRows:()=>height,getNumColumns:()=>width,
      getValue:()=>data[name][row-1]?.[column-1]??'',
      getValues:()=>Array.from({length:height},(_,i)=>Array.from({length:width},(_,j)=>data[name][row+i-1]?.[column+j-1]??'')),
      setValue:(value:unknown)=>{data[name][row-1][column-1]=value;writes.push({sheet:name,row,column,value});},
    };
  }
  for(const name of Object.keys(data))sheets[name]={getName:()=>name,getLastRow:()=>data[name].length,getLastColumn:()=>data[name][0].length,getMaxColumns:()=>Math.max(...data[name].map(r=>r.length)),getRange:(r,c,h=1,w=1)=>range(name,r,c,h,w)};
  const book={getId:()=> '16jhqgiYLh_GCkuxPL2fpljf04-Pj2HAqNY_0ePT0z7w',getSheetByName:(n:string)=>sheets[n]};
  const context=createContext({});runInContext(script,context);runInContext('BLOQUEO_=function(fn){return fn();};',context);
  function edit(name:string,row:number,column:number,value:unknown,eventValue:unknown=value) {
    data[name][row-1][column-1]=value;
    context.event={source:book,range:range(name,row,column),value:eventValue};runInContext('EDITAR_ESTADOS_WHATSAPP(event)',context);
  }
  return {data,writes,context,book,range,edit,run:(code:string)=>runInContext(code,context)};
}
const wa='WA AUXILIAR DE FARMACIA M-V 18-20';
describe('desplegables de WhatsApp sincronizados en ambos sentidos',()=>{
  it('editar el SI del curso actualiza solo la columna de grupo del alumno correcto',()=>{
    const h=setup();h.edit(wa,3,5,'SI');expect(h.data.MATRICULAS[1][4]).toBe('SI');expect(h.data.MATRICULAS[1][5]).toBe('REALIZADO');expect(h.data.MATRICULAS[2][4]).toBe('');
    expect(h.writes.every(w=>w.column===5)).toBe(true);
  });
  it('editar Matrículas actualiza la celda del curso sin cambiar REALIZADO',()=>{
    const h=setup();h.edit('MATRICULAS',2,5,'SI');expect(h.data[wa][2][4]).toBe('SI');expect(h.data.MATRICULAS[1][5]).toBe('REALIZADO');
  });
  it('cada matrícula conserva su estado independiente dentro del mismo curso',()=>{
    const h=setup();h.edit(wa,4,5,'SI');expect(h.data.MATRICULAS[2][4]).toBe('SI');expect(h.data.MATRICULAS[1][4]).toBe('NO');
  });
  it('permite borrar una marca sin inventar SI ni NO',()=>{
    const h=setup();h.edit(wa,3,5,'');expect(h.data.MATRICULAS[1][4]).toBe('');
  });
  it('rechaza valores de contacto como si fueran agregado al grupo',()=>{
    const h=setup();expect(()=>h.edit(wa,3,5,'REALIZADO')).toThrow('SI O NO');expect(h.writes).toHaveLength(0);
  });
  it('rechaza número duplicado y no escribe sobre un alumno ambiguo',()=>{
    const h=setup();h.data.MATRICULAS[2][0]=12;expect(()=>h.edit(wa,3,5,'SI')).toThrow('NO ES UNICO');expect(h.writes).toHaveLength(0);
  });
  it('no traslada una marca a otra cohorte aunque se altere la fila visible',()=>{
    const h=setup();h.data[wa][2][2]='2026-11-25';expect(()=>h.edit(wa,3,5,'SI')).toThrow('NO COINCIDE');expect(h.writes).toHaveLength(0);
  });
  it('un evento atrasado no sobreescribe una elección posterior en la celda',()=>{
    const h=setup();h.edit(wa,3,5,'SI','NO');expect(h.writes).toHaveLength(0);expect(h.data.MATRICULAS[1][4]).toBe('NO');
  });
  it('ignora cambios en otras columnas y en otros libros',()=>{
    const h=setup();h.edit('MATRICULAS',2,6,'NO REALIZADO');expect(h.writes).toHaveLength(0);
    h.context.event={source:{getId:()=> 'other'},range:h.range(wa,3,5),value:'SI'};h.run('EDITAR_ESTADOS_WHATSAPP(event)');expect(h.writes).toHaveLength(0);
  });
  it('instalar dos veces no duplica el activador ni crea temporizadores',()=>{
    const h=setup();h.run("handlers=['EDITAR_MATRICULAS_AUTORIZADO'];runs=0;ScriptApp={getProjectTriggers:function(){return handlers.map(function(n){return {getHandlerFunction:function(){return n;}};});},newTrigger:function(n){return {forSpreadsheet:function(){return this;},onEdit:function(){return this;},create:function(){handlers.push(n);}};}};ACTUALIZAR_LISTAS_WHATSAPP=function(){runs++;};console={log:function(){}};INSTALAR_ESTADOS_WHATSAPP();INSTALAR_ESTADOS_WHATSAPP();");
    expect(h.run("handlers.filter(function(n){return n==='EDITAR_ESTADOS_WHATSAPP';}).length")).toBe(1);expect(h.run('handlers.length')).toBe(2);
  });
});
