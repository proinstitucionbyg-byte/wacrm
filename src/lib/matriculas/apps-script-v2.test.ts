import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const script = readFileSync(join(process.cwd(), 'docs/apps-script/MATRICULAS_V2.gs'), 'utf8');
const headers = ['N°', 'FECHA DE HOY', 'HORA', 'INSTITUTO', 'ASESORA DE INGRESO', 'ASESORA DE VTAS.', 'NOMBRE COMPLETO', 'TIPO DE DOCUMENTO', 'NUMERO DE DOCUMENTO', 'F. NACIMIENTO', 'EDAD', 'CELULAR 1', 'CELULAR 2', 'DIRECCION', 'DEPARTAMENTO', 'DISTRITO', 'CORREO ELECTRONICO', 'LINK DE CARPETA DEL ESTUDIANTE', 'CURSO', 'FECHA DE INICIO', 'AGREGADOS AL WHATSAPP', 'PRIORIDAD', 'ESTADO', 'PROMO', 'OBSERVACIONES', 'OBSERVACION PARA FIDELIZACION', 'OBSERVACION PARA VENTAS', 'ID DE INICIO'];
const options = [['PRIORIDAD ALTA DIAS', 1], ['PRIORIDAD MEDIA DIAS', 5], ['FUERA DE HORARIO', '']];
const rules = [['MAINET', '11:00', '13:00', 3, 'ANTONELLA', 'SI', '', '', ''], ['ANTONELLA', '18:00', '22:00', 3, '', 'SI', '', '', '']];
function setup() {
  const rows: unknown[][] = [headers.slice(), Array(headers.length).fill('')];
  const notes = new Map<string, string>(), formulas = new Map<string, string>();
  const sheet = { getLastColumn: () => headers.length, getLastRow: () => rows.length, getRange: (r: number, c: number, h = 1, w = 1) => {
    const range = {
      getValues: () => Array.from({ length: h }, (_, i) => Array.from({ length: w }, (_, j) => rows[r + i - 1]?.[c + j - 1] ?? '')),
      getFormulas: () => Array.from({ length: h }, (_, i) => Array.from({ length: w }, (_, j) => formulas.get(`${r + i}:${c + j}`) ?? '')),
      setValue: (v: unknown) => { rows[r - 1][c - 1] = v; return range; },
      setNumberFormat: () => range,
      getDataValidation: () => null,
      getNote: () => notes.get(`${r}:${c}`) ?? '',
      setNote: (v: string) => { notes.set(`${r}:${c}`, v); return range; },
    }; return range;
  } };
  const context = createContext({ Date, Utilities: { formatDate: (d: Date, _tz: string, format: string) => {
    const shifted = new Date(d.getTime() - 5 * 3600000), iso = shifted.toISOString();
    if (format === 'yyyy-MM-dd') return iso.slice(0, 10);
    if (format === 'HH:mm') return iso.slice(11, 16);
    if (format === 'M-yyyy') return `${shifted.getUTCMonth() + 1}-${shifted.getUTCFullYear()}`;
    if (format === 'd-M') return `${shifted.getUTCDate()}-${shifted.getUTCMonth() + 1}`;
    throw new Error(format);
  } } });
  runInContext(script, context);
  context.testSheet = sheet;
  context.tables = { CONFIGURACION: options, 'ASESORAS Y HORARIOS': rules, 'CUADRO DE INICIOS': [] };
  runInContext('TABLA_ = function(n) { return tables[n] || []; }', context);
  return { rows, notes, formulas, context, evaluate: (code: string) => runInContext(code, context), process: () => runInContext("PROCESAR_FILAS_V2_(testSheet, 2, 1, 1, 28, new Date('2026-10-08T16:30:00Z'))", context) };
}
describe('Automatizacion de matriculas V2', () => {
  it('renueva el ciclo, mantiene dos fechas y archiva antes de retirar la anterior', () => {
    const h = setup();
    h.evaluate("cuadros=[]; archivo={}; ['NUTRICION Y DIETETICA','AUXILIAR DE FARMACIA','RECURSOS HUMANOS','ASISTENTE ADMINISTRATIVO','AUXILIAR DE EDUCACION INICIAL'].forEach(function(c){cuadros.push(['',c]);for(var n=1;n<=6;n++)cuadros.push(['',n,'MODULO '+n,'','','','','',n===1?new Date('2026-10-06T12:00:00-05:00'):n===2?new Date('2026-11-05T12:00:00-05:00'):'']);cuadros.push(['','ACTIVO']);}); PropertiesService={getScriptProperties:function(){return {getProperty:function(k){return archivo[k]||null;},setProperty:function(k,v){archivo[k]=v;}};}}; HOJA_=function(){return {getLastRow:function(){return cuadros.length;},getRange:function(r,c,h,w){var x={getValues:function(){return cuadros;},clearContent:function(){cuadros[r-1][c-1]='';return x;},clearNote:function(){return x;},setValue:function(v){cuadros[r-1][c-1]=v;return x;},setNumberFormat:function(){return x;},setBackground:function(){return x;}};return x;}};}; RENOVAR_CUADROS_INICIOS_(new Date('2026-11-05T12:00:00-05:00'));");
    expect(h.evaluate("cuadros.filter(function(r){return r[8] instanceof Date;}).length")).toBe(10);
    expect(h.evaluate("cuadros[1][8]")).toBe('');
    expect(h.evaluate("DIA_(cuadros[2][8])")).toBe('2026-11-05');
    expect(h.evaluate("DIA_(cuadros[3][8])")).toBe('2026-12-03');
    expect(h.evaluate("Object.keys(archivo).length")).toBe(5);
    h.evaluate("RENOVAR_CUADROS_INICIOS_(new Date('2026-11-06T12:00:00-05:00'));");
    expect(h.evaluate("cuadros.filter(function(r){return r[8] instanceof Date;}).length")).toBe(10);
  });
  it('calcula feriados moviles y el ciclo siguiente con ocho clases', () => {
    const h=setup();
    expect(h.evaluate("FERIADO_PERU_('2026-04-02')")).toBe(true);
    expect(h.evaluate("FERIADO_PERU_('2027-03-25')")).toBe(true);
    expect(h.evaluate("SIGUIENTE_INICIO_CICLICO_('2026-10-06',[2,4],[])")).toBe('2026-11-05');
    expect(h.evaluate("SIGUIENTE_INICIO_CICLICO_('2026-09-25',[3,5],['2026-10-07'])")).toBe('2026-10-28');
  });
  it('resalta unicamente el modulo vigente en cada cuadro', () => {
    const h = setup();
    h.evaluate("cuadros=[]; colores=[]; ['NUTRICION Y DIETETICA','AUXILIAR DE FARMACIA','RECURSOS HUMANOS','ASISTENTE ADMINISTRATIVO','AUXILIAR DE EDUCACION INICIAL'].forEach(function(c){cuadros.push(['',c]);for(var n=1;n<=6;n++)cuadros.push(['',n,'MODULO '+n,'','','','','',n===1?new Date('2026-10-06T12:00:00-05:00'):n===2?new Date('2026-11-05T12:00:00-05:00'):'']);cuadros.push(['','ACTIVO']);}); HOJA_=function(){return {getLastRow:function(){return cuadros.length;},getRange:function(r,c,h,w){return {getValues:function(){return cuadros;},setBackground:function(color){colores.push([r,c,h,w,color]);}};}};}; RESALTAR_CUADROS_INICIOS_(new Date('2026-10-08T12:00:00-05:00'));");
    expect(h.evaluate("colores.filter(function(c){return c[4]==='#00ff00';}).length")).toBe(5);
    expect(h.evaluate('colores.length')).toBe(30);
    h.evaluate("colores=[]; RESALTAR_CUADROS_INICIOS_(new Date('2026-11-05T12:00:00-05:00'));");
    expect(h.evaluate("colores.filter(function(c){return c[4]==='#00ff00';})[0][0]")).toBe(3);
  });
  it('lee los cinco cuadros visuales sin alterar sus celdas', () => {
    const h = setup();
    h.evaluate("cuadros=[]; ['NUTRICION Y DIETETICA','AUXILIAR DE FARMACIA','RECURSOS HUMANOS','ASISTENTE ADMINISTRATIVO','AUXILIAR DE EDUCACION INICIAL'].forEach(function(c){cuadros.push(['',c+' - HORARIO']);for(var n=1;n<=6;n++){var r=['',n,'MODULO '+n,'','','','','',n===1?new Date('2026-10-06T12:00:00-05:00'):''];cuadros.push(r);}cuadros.push(['','ACTIVO']);});");
    const result = h.evaluate('LEER_CUADROS_INICIOS_(cuadros)');
    expect(result).toHaveLength(5);
    expect(result[0][0]).toBe('NUTRICION Y DIETETICA M-J 20-22:1:2026');
    expect(result[0][2]).toBe('MODULO 1');
    expect(result[4][1]).toBe('EDUCACION INICIAL L-M 18-20');
    h.evaluate("cuadros[1][8]='FECHA MAL ESCRITA';");
    expect(() => h.evaluate('LEER_CUADROS_INICIOS_(cuadros)')).toThrow('FECHA NO VALIDA');
  });
  it('conserva compatibilidad con inicios tabulares anteriores', () => {
    const h = setup();
    expect(h.evaluate("LEER_CUADROS_INICIOS_([['ID DE INICIO'],['ID1','CURSO','MODULO','FECHA','SI']])")).toEqual([['ID1','CURSO','MODULO','FECHA','SI']]);
    expect(() => h.evaluate("LEER_CUADROS_INICIOS_([])")).toThrow('CINCO CURSOS');
  });
  it('calcula edad antes, el dia y despues del cumpleanos en Lima', () => {
    const h = setup();
    expect(h.evaluate("EDAD_(new Date('2000-10-09T12:00:00-05:00'), new Date('2026-10-08T12:00:00-05:00'))")).toBe(25);
    expect(h.evaluate("EDAD_(new Date('2000-10-08T12:00:00-05:00'), new Date('2026-10-08T12:00:00-05:00'))")).toBe(26);
    expect(h.evaluate("EDAD_('', new Date())")).toBe('');
  });
  it('no inventa edades para fechas futuras', () => {
    expect(setup().evaluate("EDAD_(new Date('2030-01-01'), new Date('2026-01-01'))")).toBe('');
  });
  it('calcula las prioridades por dias de calendario y no horas', () => {
    const h = setup();
    expect(h.evaluate("PRIORIDAD_(new Date('2026-10-09T00:00:00-05:00'), new Date('2026-10-08T23:59:59-05:00'), 1, 5)")).toBe('ALTA');
    expect(h.evaluate("PRIORIDAD_(new Date('2026-10-13T12:00:00-05:00'), new Date('2026-10-08T12:00:00-05:00'), 1, 5)")).toBe('MEDIA');
    expect(h.evaluate("PRIORIDAD_(new Date('2026-10-14T12:00:00-05:00'), new Date('2026-10-08T12:00:00-05:00'), 1, 5)")).toBe('BAJA');
  });
  it('acepta los limites horarios exactos y rechaza horas invalidas', () => {
    const h = setup();
    expect(h.evaluate("MINUTOS_('22:00')")).toBe(1320);
    expect(h.evaluate("MINUTOS_('24:00')")).toBeNull();
    expect(h.evaluate("MINUTOS_('18:99')")).toBeNull();
  });
  it('quita separadores telefonicos sin eliminar letras erroneas ni el signo +', () => {
    const h = setup();
    expect(h.evaluate("LIMPIAR_IDENTIFICADOR_(' +51 (937)-111 222 ', true)")).toBe('+51937111222');
    expect(h.evaluate("LIMPIAR_IDENTIFICADOR_(' 74 73 RZ ', false)")).toBe('7473RZ');
    expect(h.evaluate("ERRORES_DATOS_('DNI', '7473RZ', '937P22', '', 'alumno@otro.com')")).toContain('DNI DEBE CONTENER SOLO NUMEROS');
    expect(h.evaluate("ERRORES_DATOS_('DNI', '7473RZ', '937P22', '', 'alumno@otro.com')")).toContain('REVISAR CELULAR 1');
  });
  it('acepta documento alfanumerico sin inventar una regla de longitud', () => {
    expect(setup().evaluate("ERRORES_DATOS_('PASAPORTE', 'AB00123', '+51999999999', '', 'a@gmail.com')")).toEqual([]);
  });
  it('asigna los turnos nuevos de MAINET y ANTONELLA', () => {
    const h = setup(); h.context.rules = rules;
    expect(h.evaluate("ELEGIR_ASESORA_(new Date('2026-10-08T16:00:00Z'), '11:00', rules, {}, '')")).toBe('MAINET');
    expect(h.evaluate("ELEGIR_ASESORA_(new Date('2026-10-08T23:00:00Z'), '18:00', rules, {}, '')")).toBe('ANTONELLA');
    expect(h.evaluate("ELEGIR_ASESORA_(new Date('2026-10-08'), '13:00', rules, {}, '')")).toBe('');
    expect(h.evaluate("ELEGIR_ASESORA_(new Date('2026-10-08'), '22:00', rules, {}, '')")).toBe('');
  });
  it('respeta maximo, desborde y capacidad del destino', () => {
    const h = setup(); h.context.rules = rules;
    expect(h.evaluate("ELEGIR_ASESORA_(new Date('2026-10-08T16:00:00Z'), '11:30', rules, {'2026-10-08|MAINET':3}, '')")).toBe('ANTONELLA');
    expect(h.evaluate("ELEGIR_ASESORA_(new Date('2026-10-08T16:00:00Z'), '11:30', rules, {'2026-10-08|MAINET':3,'2026-10-08|ANTONELLA':3}, '')")).toBe('');
  });
  it('no asigna cuando falta el maximo diario ni ante horarios superpuestos', () => {
    const h = setup();
    expect(h.evaluate("ELEGIR_ASESORA_(new Date('2026-10-08T16:00:00Z'), '11:30', [['MAINET','11:00','13:00','','','SI']], {}, '')")).toBe('');
    expect(() => h.evaluate("ELEGIR_ASESORA_(new Date('2026-10-08T16:00:00Z'), '11:30', [['MAINET','11:00','13:00',3,'','SI'],['OTRA','11:00','13:00',3,'','SI']], {}, '')")).toThrow('SUPERPUESTOS');
  });
  it('respeta fecha de vigencia y no asigna fuera de ella', () => {
    expect(setup().evaluate("ELEGIR_ASESORA_(new Date('2026-10-08T16:00:00Z'), '11:30', [['MAINET','11:00','13:00',3,'','SI','',new Date('2026-10-09T12:00:00Z'),'']], {}, '')")).toBe('');
  });
  it('conserva exactamente el orden de carpetas y quita tildes de sus nombres', () => {
    expect(setup().evaluate("RUTA_ESTUDIANTE_(new Date('2026-10-08T16:00:00Z'), 'MARÍA PÉREZ', '001234', 'NUTRICIÓN')")).toEqual(['10-2026', '8-10', 'MARIA PEREZ-001234', 'NUTRICION', 'PRIMER PAGO']);
  });
  it('reutiliza la identidad normalizada pero rechaza otro nombre para el mismo documento', () => {
    const h = setup();
    expect(() => h.evaluate("VERIFICAR_IDENTIDAD_CARPETA_('MARIA PEREZ-001234', '  María   Pérez ', '00 1234')")).not.toThrow();
    expect(() => h.evaluate("VERIFICAR_IDENTIDAD_CARPETA_('OTRA PERSONA-001234', 'MARIA PEREZ', '001234')")).toThrow('NO COINCIDEN');
    expect(() => h.evaluate("VERIFICAR_IDENTIDAD_CARPETA_('MARIA PEREZ-999999', 'MARIA PEREZ', '001234')")).toThrow('NO COINCIDEN');
  });
  it('registra, normaliza, calcula edad y conserva el momento al editar', () => {
    const h = setup(); h.rows[1][6] = '  maría   pérez '; h.rows[1][7] = 'DNI'; h.rows[1][8] = ' 0012 34 '; h.rows[1][9] = new Date('2000-01-01T12:00:00Z');
    h.rows[1][11] = '+51 (999)-123 456'; h.process();
    expect(h.rows[1][6]).toBe('MARÍA PÉREZ'); expect(h.rows[1][8]).toBe('001234'); expect(h.rows[1][11]).toBe('+51999123456');
    expect(h.rows[1][10]).toBe(26); expect(h.rows[1][4]).toBe('MAINET');
    const timestamp = h.rows[1][1]; expect(h.rows[1][2]).toBe(timestamp);
    h.process(); expect(h.rows[1][1]).toBe(timestamp); expect(h.rows[1][0]).toBe(1);
  });
  it('conserva formulas y no inventa la hora de registros historicos', () => {
    const h = setup(); h.rows[1][6] = 'maria'; h.rows[1][1] = new Date('2025-01-01'); h.rows[1][10] = 'CALCULADA'; h.formulas.set('2:11', '=DATEDIF(J2,TODAY(),"Y")'); h.process();
    expect(h.rows[1][2]).toBe(''); expect(h.rows[1][10]).toBe('CALCULADA');
  });
  it('marca realizado y vuelve a pendiente si se desmarca WhatsApp', () => {
    const h = setup(); h.rows[1][6] = 'maria'; h.rows[1][20] = true; h.process(); expect(h.rows[1][22]).toBe('REALIZADO');
    h.rows[1][20] = false; h.process(); expect(h.rows[1][22]).toBe('NO REALIZADO');
  });
  it('no mezcla cursos que tienen varios inicios ni pisa una fecha sin ID', () => {
    const h = setup(); h.rows[1][6] = 'maria'; h.rows[1][18] = 'NUTRICION'; h.rows[1][19] = new Date('2026-10-12T12:00:00Z');
    h.process(); expect(h.rows[1][19]).toEqual(new Date('2026-10-12T12:00:00Z'));
  });
  it('actualiza por ID de inicio exacto y curso coincidente', () => {
    const h = setup(); h.rows[1][6] = 'maria'; h.rows[1][18] = 'NUTRICION'; h.rows[1][27] = 'NUT-12';
    h.context.tables = { CONFIGURACION: options, 'ASESORAS Y HORARIOS': rules, 'CUADRO DE INICIOS': [['NUT-12', 'NUTRICION', 'MODULO 1', new Date('2026-10-12T12:00:00Z'), 'SI']] };
    h.process(); expect(h.rows[1][19]).toEqual(new Date('2026-10-12T12:00:00Z')); expect(h.rows[1][21]).toBe('MEDIA');
  });
  it('preserva notas manuales y reemplaza solo su observacion automatica', () => {
    const h = setup(); h.rows[1][6] = 'maria'; h.rows[1][7] = 'DNI'; h.rows[1][8] = 'ABC'; h.notes.set('2:25', 'NOTA DE LA ASESORA'); h.process();
    expect(h.notes.get('2:25')).toContain('NOTA DE LA ASESORA'); expect(h.notes.get('2:25')).toContain('DNI DEBE');
    h.rows[1][8] = '123'; h.process(); expect(h.notes.get('2:25')).toBe('NOTA DE LA ASESORA');
  });
});
