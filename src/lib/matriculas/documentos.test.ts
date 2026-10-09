import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

function setup() {
  const context = createContext({ Date, Utilities: { formatDate: (d: Date) => new Date(d.getTime() - 5 * 3600000).toISOString().slice(0, 10) } });
  runInContext(readFileSync('docs/apps-script/DOCUMENTOS_MATRICULA.gs', 'utf8'), context);
  return (code: string) => runInContext(code, context);
}
describe('Documentos de matricula', () => {
  it('elimina las tres copias temporales y conserva las plantillas', () => {
    const run = setup();
    run("trabajos={'TRABAJO PDF:7:BOLETA':'TEMP1','TRABAJO PDF:7:CRONOGRAMA':'TEMP2','TRABAJO PDF:7:FICHA':'TEMP3'}; eliminados=[]; PropertiesService={getScriptProperties:function(){return {getProperty:function(k){return trabajos[k];},deleteProperty:function(k){delete trabajos[k];}};}}; DriveApp={getFileById:function(id){return {setTrashed:function(v){if(v) eliminados.push(id);}};}};");
    run('D_LIMPIAR_COPIAS(7)');
    expect(Array.from(run('eliminados'))).toEqual(['TEMP1','TEMP2','TEMP3']);
    expect(run('Object.keys(trabajos).length')).toBe(0);
    run("trabajos['TRABAJO PDF:8:BOLETA']=DOC.boleta;");
    expect(() => run('D_LIMPIAR_COPIAS(8)')).toThrow('PLANTILLA ORIGINAL');
  });
  it('limpia solo despues de guardar los tres PDF; conserva copias si falla una exportacion', () => {
    const run = setup();
    run("eventos=[]; PropertiesService={getScriptProperties:function(){return {getProperty:function(){return 'SIMULACION';}};}}; DriveApp={getFolderById:function(){return {};}}; D_CARPETA=function(){return {getUrl:function(){return 'CARPETA';}};}; D_PDF=function(t){eventos.push(t);return {getUrl:function(){return t;}};}; D_LIMPIAR_COPIAS=function(){eventos.push('LIMPIAR');};");
    run("D_GENERAR({numero:7,estudianteId:'TEST',curso:'TEST'},true)");
    expect(Array.from(run('eventos'))).toEqual(['BOLETA','CRONOGRAMA','FICHA','LIMPIAR']);
    run("eventos=[]; D_PDF=function(t){eventos.push(t);if(t==='CRONOGRAMA') throw new Error('EXPORTACION'); return {getUrl:function(){return t;}};};");
    expect(() => run("D_GENERAR({numero:7,estudianteId:'TEST',curso:'TEST'},true)")).toThrow('EXPORTACION');
    expect(Array.from(run('eventos'))).toEqual(['BOLETA','CRONOGRAMA']);
  });
  it('muestra horarios de tarde con AM/PM sin cambiar la clave del curso', () => {
    const run = setup();
    expect(run("D_CURSO_VISIBLE('NUTRICION Y DIETETICA M-J 20-22')")).toBe('NUTRICION Y DIETETICA M-J 8:00 PM A 10:00 PM');
    expect(run("D_CURSO_VISIBLE('FARMACIA M-V 18-20')")).toBe('FARMACIA M-V 6:00 PM A 8:00 PM');
    expect(run("D_CURSO_VISIBLE('CURSO SIN HORARIO')")).toBe('CURSO SIN HORARIO');
  });
  it('reserva numeros consecutivos de boleta en el contador compartido', () => {
    const run = setup();
    run("contador=1031952; SpreadsheetApp={openById:function(){return {getSheetByName:function(){return {getRange:function(){return {getValue:function(){return contador;},setValue:function(v){contador=v;}};}};}};},flush:function(){}};");
    expect(run('D_NUMERO()')).toBe(1031952);
    expect(run('D_NUMERO()')).toBe(1031953);
    expect(run('contador')).toBe(1031954);
  });
  it('nombra los PDF con tipo, nombre sin tildes y documento', () => {
    expect(setup()("D_NOMBRE_PDF('FICHA',{nombre:'  José   Pérez ',doc:'00123456',numero:'99'})")).toBe('FICHA-JOSE PEREZ-00123456.pdf');
  });
  it('exporta en una pagina A4 vertical con margenes iguales', () => {
    const url = new URL(setup()("D_URL_PDF('LIBRO',123,'B2:H46')"));
    expect(url.searchParams.get('size')).toBe('A4');
    expect(url.searchParams.get('scale')).toBe('4');
    expect(url.searchParams.get('portrait')).toBe('true');
    for (const side of ['top', 'bottom', 'left', 'right']) expect(url.searchParams.get(side + '_margin')).toBe('0.4');
    expect(url.searchParams.get('range')).toBe('B2:H46');
  });
  it('rechaza reutilizar un PDF de otra matricula con el mismo nombre', () => {
    const run = setup();
    run("testFile = {getDescription: function(){return 'MATRICULA_DOC:1';}}; testFolder = {getFilesByName: function(){var done=false;return {hasNext:function(){return !done;},next:function(){done=true;return testFile;}};}};");
    expect(() => run("D_PDF('FICHA',{nombre:'PRUEBA',doc:'00000000',numero:'2'},testFolder,'SERIE')")).toThrow('PDF DE OTRA MATRICULA');
    expect(run("D_PDF('FICHA',{nombre:'PRUEBA',doc:'00000000',numero:'1'},testFolder,'SERIE')")).toBe(run('testFile'));
  });
  it.each([
    ['2026-10-01', '2026-10-30'], ['2026-10-09', '2026-10-30'],
    ['2026-10-10', '2026-11-15'], ['2026-10-25', '2026-11-15'],
    ['2026-10-26', '2026-11-30'], ['2026-10-31', '2026-11-30'],
    ['2027-02-01', '2027-02-28'], ['2028-02-01', '2028-02-29'],
    ['2026-12-31', '2027-01-30'],
  ])('inicio %s produce segunda cuota %s', (inicio, segunda) => {
    const fechas = setup()(`D_VENCIMIENTOS('${inicio}')`);
    expect(fechas).toHaveLength(5);
    expect(fechas[0]).toBe(segunda);
  });
  it('recupera el 30 despues de febrero, sin arrastrar el dia 28', () => {
    expect(Array.from(setup()("D_VENCIMIENTOS('2027-01-31')"))).toEqual(['2027-02-28', '2027-03-30', '2027-04-30', '2027-05-30', '2027-06-30']);
  });
  it('desglosa IGV incluido, sin sumarlo otra vez', () => {
    expect(setup()('D_IGV(19.90)')).toEqual({ base: 16.86, igv: 3.04, total: 19.9 });
    expect(setup()('D_IGV(79.90)')).toEqual({ base: 67.71, igv: 12.19, total: 79.9 });
  });
  it('rechaza fechas imposibles y montos ausentes o negativos', () => {
    const run = setup();
    expect(() => run("D_DIA('2026-02-30')")).toThrow('FECHA INVALIDA');
    for (const value of ["''", 'null', '-1', '1.234']) expect(() => run(`D_MONTO(${value})`)).toThrow();
  });
  it('usa las opciones exactas de la boleta para los medios de pago', () => {
    const run = setup();
    for (const metodo of ['YAPE', 'Plin', 'Yape/Plin']) expect(run(`D_METODO('${metodo}')`)).toBe('Yape/Plin');
    expect(run("D_METODO('TRANSFERENCIA/DEPÓSITO')")).toBe('Tranferencia/Depósito');
    expect(run("D_METODO('EFECTIVO')")).toBe('Efectivo');
    expect(run("D_METODO('MERCADO PAGO')")).toBe('Mercado Pago');
    expect(() => run("D_METODO('OTRO')")).toThrow('METODO DE PAGO NO RECONOCIDO');
  });
  it('escribe los datos en las celdas verificadas y conserva la fecha del primer pago', () => {
    const run = setup();
    run("testCells = {}; testSheet = { getRange: function(c) { return { setNumberFormat: function() { return this; }, setValue: function(v) { testCells[c] = v; }, setFormula: function(v) { testCells[c] = v; } }; } }; testData = {nombre:'ESTUDIANTE DE PRUEBA',doc:'00000000',tipo:'DNI',curso:'NUTRICION',inicio:'2026-10-12',pago:'2026-10-08',emision:'2026-10-08',monto:19.9,metodo:'YAPE',promo:{precios:[19.9,79.9,79.9,79.9,79.9,79.9]},celulares:'000000001',correo:'prueba@example.com'};");
    run("D_LLENAR(testSheet,'CRONOGRAMA',testData,'SIMULACION')");
    expect(run('testCells.E11')).toBe('ESTUDIANTE DE PRUEBA');
    expect(run('D_DIA(testCells.F21)')).toBe('2026-10-08');
    expect(run('D_DIA(testCells.F22)')).toBe('2026-11-15');
    expect(run('testCells.G26')).toBe(79.9);
    run("D_LLENAR(testSheet,'BOLETA',testData,'SIMULACION')");
    expect(run('testCells.O58')).toBe(19.9);
    expect(run('testCells.M15')).toBe('Yape/Plin');
    expect(run('testCells.M6')).toBe('SIMULACION');
    expect(run('testCells.O62')).toBe('=O58');
  });
});
