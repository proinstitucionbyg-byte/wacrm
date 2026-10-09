/** REEMPLAZA el codigo anterior. Ejecutar INSTALAR_MATRICULAS_V2 una vez. */
const V2 = { admin: '12qF1Y0X4PjY6YtnWJG7NyQ15cWmXK9fW-7gMWKJxLQc', id: '16jhqgiYLh_GCkuxPL2fpljf04-Pj2HAqNY_0ePT0z7w', tz: 'America/Lima' };
function TEXTO_(v) { return String(v == null ? '' : v).trim().replace(/\s+/g, ' '); }
function CLAVE_(v) { return TEXTO_(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase(); }
function DIA_(v) { return v instanceof Date && !isNaN(v) ? Utilities.formatDate(v, V2.tz, 'yyyy-MM-dd') : ''; }
function MAPA_(s) {
  const h = s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0];
  const m = {}; h.forEach(function (v, i) { if (TEXTO_(v)) { const k = CLAVE_(v); if (m[k]) throw new Error('CABECERA REPETIDA: ' + k); m[k] = i + 1; } });
  return m;
}
function LIBRO_() { const ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(V2.id); if (ss.getId() !== V2.id) throw new Error('LIBRO INCORRECTO'); return ss; }
function ES_ADMIN_(nombre) { return ['CONFIGURACION', 'ASESORAS Y HORARIOS', 'VALIDACIONES', 'PENDIENTES WHATSAPP'].indexOf(nombre) !== -1; }
function HOJA_(nombre) { const s = (ES_ADMIN_(nombre) ? SpreadsheetApp.openById(V2.admin) : LIBRO_()).getSheetByName(nombre); if (!s) throw new Error('FALTA PESTANA ' + nombre); return s; }
function TABLA_(nombre) { const s = HOJA_(nombre); if (nombre === 'CUADRO DE INICIOS') return LEER_CUADROS_INICIOS_(s.getRange(1, 1, s.getLastRow(), 9).getValues()); return s.getLastRow() < 2 ? [] : s.getRange(2, 1, s.getLastRow() - 1, s.getLastColumn()).getValues(); }
/** Adapta el cuadro visual sin convertirlo en una tabla ni cambiar sus celdas. */
function LEER_CUADROS_INICIOS_(filas) {
  if (CLAVE_((filas[0] || [])[0]) === 'ID DE INICIO') return filas.slice(1); // Compatibilidad con formato anterior.
  const cursos = [
    ['NUTRICION Y DIETETICA', 'NUTRICION Y DIETETICA M-J 20-22'],
    ['AUXILIAR DE FARMACIA', 'AUXILIAR DE FARMACIA M-V 18-20'],
    ['RECURSOS HUMANOS', 'RECURSOS HUMANOS L-M 20-22'],
    ['ASISTENTE ADMINISTRATIVO', 'ASISTENTE ADMINISTRATIVO M-V 20-22'],
    ['AUXILIAR DE EDUCACION INICIAL', 'EDUCACION INICIAL L-M 18-20']
  ];
  const bloques = [], salida = []; let actual = null;
  filas.forEach(function (fila) {
    const titulo = CLAVE_(fila[1]), curso = cursos.filter(function (c) { return titulo.indexOf(c[0]) === 0; });
    if (curso.length === 1) { actual = { curso: curso[0][1], modulos: [], estado: '' }; bloques.push(actual); return; }
    if (!actual) return;
    if (titulo === 'ACTIVO' || titulo === 'INACTIVO') { actual.estado = titulo; actual = null; return; }
    const numero = Number(fila[1]);
    if (Number.isInteger(numero) && numero >= 1 && numero <= 6) {
      if (!TEXTO_(fila[2])) throw new Error('MODULO SIN NOMBRE EN ' + actual.curso);
      actual.modulos.push({ numero: numero, nombre: CLAVE_(fila[2]), fecha: fila[8] });
    }
  });
  if (bloques.length !== 5 || new Set(bloques.map(function (b) { return b.curso; })).size !== 5) throw new Error('REVISAR CUADROS: SE ESPERAN LOS CINCO CURSOS');
  bloques.forEach(function (b) {
    if (b.modulos.length !== 6 || new Set(b.modulos.map(function (m) { return m.numero; })).size !== 6 || !b.estado) throw new Error('CUADRO INCOMPLETO EN ' + b.curso);
    b.modulos.forEach(function (m) {
      const dia = DIA_(m.fecha);
      if (m.fecha !== '' && m.fecha != null && !dia) throw new Error('FECHA NO VALIDA EN ' + b.curso + ': ' + m.nombre);
      if (dia) salida.push([b.curso + ':' + m.numero + ':' + dia.slice(0, 4), b.curso, m.nombre, m.fecha, b.estado === 'ACTIVO' ? 'SI' : 'NO']);
    });
  });
  return salida;
}
function VERIFICAR_CUADROS_INICIOS() {
  const filas = TABLA_('CUADRO DE INICIOS'), cursos = new Set(filas.map(function (f) { return f[1]; }));
  console.log('LECTURA VERIFICADA: ' + cursos.size + ' CURSOS, ' + filas.length + ' FECHAS. SIN CAMBIAR MATRICULAS.');
  return filas;
}
function RESALTAR_CUADROS_INICIOS_(hoy) {
  const s = HOJA_('CUADRO DE INICIOS'), filas = s.getRange(1, 1, s.getLastRow(), 9).getValues();
  LEER_CUADROS_INICIOS_(filas); // Validar todo antes de escribir colores.
  if (CLAVE_((filas[0] || [])[0]) === 'ID DE INICIO') return;
  let modulos = [];
  filas.forEach(function (r, i) {
    const n = Number(r[1]), estado = CLAVE_(r[1]);
    if (Number.isInteger(n) && n >= 1 && n <= 6 && TEXTO_(r[2])) modulos.push({fila:i + 1, dia:DIA_(r[8])});
    if (estado !== 'ACTIVO' && estado !== 'INACTIVO') return;
    const actuales = modulos.filter(function (m) { return m.dia && m.dia <= DIA_(hoy); }).sort(function (a,b) { return b.dia.localeCompare(a.dia); });
    modulos.forEach(function (m) { s.getRange(m.fila, 3, 2, 8).setBackground(estado === 'ACTIVO' && actuales.length && m.fila === actuales[0].fila ? '#00ff00' : '#ffffff'); });
    modulos = [];
  });
}
function FERIADO_PERU_(iso) {
  const fijos = ['01-01','05-01','06-07','06-29','07-23','07-28','07-29','08-06','08-30','10-08','11-01','12-08','12-09','12-25'];
  if (fijos.indexOf(iso.slice(5)) !== -1) return true;
  const y = Number(iso.slice(0,4)), a=y%19, b=Math.floor(y/100), c=y%100, d=Math.floor(b/4), e=b%4, f=Math.floor((b+8)/25), g=Math.floor((b-f+1)/3), h=(19*a+b-d-g+15)%30, i=Math.floor(c/4), k=c%4, l=(32+2*e+2*i-h-k)%7, m=Math.floor((a+11*h+22*l)/451), mes=Math.floor((h+l-7*m+114)/31), dia=(h+l-7*m+114)%31+1;
  const pascua = new Date(Date.UTC(y,mes-1,dia,12));
  return [2,3].some(function(n){return new Date(pascua.getTime()-n*86400000).toISOString().slice(0,10)===iso;});
}
function SIGUIENTE_INICIO_CICLICO_(inicio, dias, canceladas) {
  let d = new Date(inicio + 'T12:00:00Z'), clases = 0;
  for (let i=0;i<730;i++,d=new Date(d.getTime()+86400000)) {
    const iso=d.toISOString().slice(0,10);
    if (dias.indexOf(d.getUTCDay())===-1 || FERIADO_PERU_(iso) || canceladas.indexOf(iso)!==-1) continue;
    if (++clases===9) return iso;
  }
  throw new Error('NO SE PUDO PROYECTAR EL SIGUIENTE MODULO');
}
/** La vista conserva dos fechas; el historial queda en propiedades del programa. */
function RENOVAR_CUADROS_INICIOS_(hoy) {
  const s=HOJA_('CUADRO DE INICIOS'), filas=s.getRange(1,1,s.getLastRow(),9).getValues();
  LEER_CUADROS_INICIOS_(filas);
  const props=PropertiesService.getScriptProperties(), cambios=[]; let titulo='', modulos=[];
  filas.forEach(function(r,i){
    const n=Number(r[1]), estado=CLAVE_(r[1]);
    if (/^(NUTRICION Y DIETETICA|AUXILIAR DE FARMACIA|RECURSOS HUMANOS|ASISTENTE ADMINISTRATIVO|AUXILIAR DE EDUCACION INICIAL)/.test(estado)) titulo=estado;
    if (Number.isInteger(n)&&n>=1&&n<=6&&TEXTO_(r[2])) modulos.push({fila:i+1,numero:n,nombre:CLAVE_(r[2]),dia:DIA_(r[8])});
    if (estado!=='ACTIVO'&&estado!=='INACTIVO') return;
    if (estado==='ACTIVO') {
      const dias=titulo.indexOf('NUTRICION')===0?[2,4]:(titulo.indexOf('FARMACIA')!==-1||titulo.indexOf('ADMINISTRATIVO')!==-1)?[3,5]:[1,3];
      const key='CICLO:'+titulo, guardadas=[];
      modulos.filter(function(x){return x.dia&&x.dia<=DIA_(hoy);}).forEach(function(x){guardadas.push({numero:x.numero,nombre:x.nombre,dia:x.dia});});
      const vigentes=modulos.filter(function(x){return x.dia&&x.dia<=DIA_(hoy);}).sort(function(a,b){return b.dia.localeCompare(a.dia);});
      if(!vigentes.length) throw new Error('FALTA INICIO ACTUAL EN '+titulo);
      let actual=vigentes[0], indice=modulos.indexOf(actual), inicio=actual.dia;
      const canceladas=JSON.parse(props.getProperty('CANCELACIONES:'+titulo)||'[]');
      if((titulo.indexOf('ADMINISTRATIVO')!==-1||titulo.indexOf('EDUCACION INICIAL')!==-1)&&canceladas.indexOf('2026-10-07')===-1)canceladas.push('2026-10-07');
      let proximo=modulos[(indice+1)%6], fecha=proximo.dia && proximo.dia>inicio?proximo.dia:SIGUIENTE_INICIO_CICLICO_(inicio,dias,canceladas), vueltas=0;
      while(fecha<=DIA_(hoy)) {
        if(++vueltas>120)throw new Error('REVISAR ANTIGUEDAD DEL CUADRO '+titulo);
        indice=(indice+1)%6;inicio=fecha;actual=modulos[indice];
        guardadas.push({numero:actual.numero,nombre:actual.nombre,dia:inicio});
        proximo=modulos[(indice+1)%6];fecha=SIGUIENTE_INICIO_CICLICO_(inicio,dias,canceladas);
      }
      cambios.push({modulos:modulos.slice(),actual:actual,proximo:proximo,inicio:inicio,fecha:fecha,key:key,historial:guardadas});
    }
    modulos=[];
  });
  cambios.forEach(function(c){
    c.historial.forEach(function(g){const key=c.key+':'+g.dia.slice(0,4), historial=JSON.parse(props.getProperty(key)||'[]');if(!historial.some(function(h){return h.numero===g.numero&&h.dia===g.dia;})){historial.push(g);props.setProperty(key,JSON.stringify(historial));}}); // Historial por ano antes de retirar fechas.
    c.modulos.forEach(function(m){const celda=s.getRange(m.fila,9);if(m.fila!==c.actual.fila&&m.fila!==c.proximo.fila){if(m.dia)celda.clearContent().clearNote();return;}const dia=m.fila===c.actual.fila?c.inicio:c.fecha;if(m.dia!==dia)celda.setValue(new Date(dia+'T12:00:00-05:00'));celda.setNumberFormat('dd/MM/yyyy');});
  });
  RESALTAR_CUADROS_INICIOS_(hoy);
}
function ACTUALIZAR_RESALTADO_INICIOS() { BLOQUEO_(function () { RENOVAR_CUADROS_INICIOS_(new Date()); console.log('CICLOS RENOVADOS: DOS FECHAS POR CURSO, MODULO ACTUAL EN VERDE'); }); }
function INSTALAR_RENOVACION_INICIOS() {
  ACTUALIZAR_RESALTADO_INICIOS();
  if(!ScriptApp.getProjectTriggers().some(function(t){return t.getHandlerFunction()==='ACTUALIZAR_RESALTADO_INICIOS';}))ScriptApp.newTrigger('ACTUALIZAR_RESALTADO_INICIOS').timeBased().everyMinutes(10).create();
  console.log('RENOVACION AUTOMATICA INSTALADA CADA DIEZ MINUTOS');
}
function OPCIONES_() { const o = {}; TABLA_('CONFIGURACION').forEach(function (r) { o[CLAVE_(r[0])] = r[1]; }); return o; }
function BLOQUEO_(fn) { const l = LockService.getScriptLock(); l.waitLock(20000); try { const r = fn(); SpreadsheetApp.flush(); return r; } finally { l.releaseLock(); } }
function CREAR_TABLA_(ss, nombre, cabeceras, filas) {
  if (ES_ADMIN_(nombre)) ss = SpreadsheetApp.openById(V2.admin);
  let s = ss.getSheetByName(nombre);
  if (!s) { s = ss.insertSheet(nombre); s.getRange(1, 1, 1, cabeceras.length).setValues([cabeceras]); if (filas && filas.length) s.getRange(2, 1, filas.length, cabeceras.length).setValues(filas); }
  const actuales = s.getRange(1, 1, 1, cabeceras.length).getValues()[0].map(CLAVE_);
  if (actuales.join('|') !== cabeceras.join('|')) throw new Error('REVISAR CABECERAS DE ' + nombre);
  s.setFrozenRows(1); s.getRange(1, 1, 1, cabeceras.length).setFontWeight('bold').setWrap(true);
  return s;
}
function LISTA_(s, columna, opciones) {
  if (!columna) return;
  s.getRange(2, columna, s.getMaxRows() - 1, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(opciones, true).setAllowInvalid(false).build());
}
function INSTALAR_MATRICULAS_V2() {
  BLOQUEO_(function () {
    const ss = SpreadsheetApp.openById(V2.id), s = ss.getSheetByName('MATRICULAS');
    if (!s) throw new Error('FALTA MATRICULAS');
    let m = MAPA_(s);
    ['N°', 'FECHA DE HOY', 'HORA', 'NOMBRE COMPLETO', 'EDAD', 'CURSO'].forEach(function (k) { if (!m[k]) throw new Error('FALTA ' + k); });
    if (!m['TIPO DE DOCUMENTO']) {
      if (!m.DNI) throw new Error('FALTA DNI PARA LA MIGRACION');
      s.insertColumnBefore(m.DNI); s.getRange(1, m.DNI).setValue('TIPO DE DOCUMENTO'); s.getRange(1, m.DNI + 1).setValue('NUMERO DE DOCUMENTO');
    }
    m = MAPA_(s);
    if (!m['ID DE INICIO']) s.getRange(1, s.getLastColumn() + 1).setValue('ID DE INICIO');
    m = MAPA_(s); ss.setSpreadsheetTimeZone(V2.tz);
    ['NUMERO DE DOCUMENTO', 'CELULAR 1', 'CELULAR 2', 'ID DE INICIO'].forEach(function (k) { s.getRange(2, m[k], s.getMaxRows() - 1, 1).setNumberFormat('@').setHorizontalAlignment('center'); });
    LISTA_(s, m['TIPO DE DOCUMENTO'], ['DNI', 'CARNE DE EXTRANJERIA', 'PASAPORTE', 'OTRO']);
    CREAR_TABLA_(ss, 'CONFIGURACION', ['CLAVE', 'VALOR', 'DESCRIPCION'], [
      ['CARPETA GENERAL ID', '', 'ID O ENLACE DE LA CARPETA GENERAL DE ALUMNOS'],
      ['PRIORIDAD ALTA DIAS', 1, 'INICIO HOY, MANANA O VENCIDO'],
      ['PRIORIDAD MEDIA DIAS', 5, 'ENTRE 2 Y 5 DIAS; MAYOR A 5: BAJA'],
      ['FUERA DE HORARIO', '', 'ASESORA; VACIO SIGNIFICA PENDIENTE'],
      ['CALENDARIO ACTIVO', 'NO', 'SI SOLO DESPUES DE CONFIGURAR LOS CALENDARIOS'],
      ['HORA AVISO', '', 'HH:mm EN LIMA; PENDIENTE DE DEFINIR'],
    ]);
    const asesoras = CREAR_TABLA_(ss, 'ASESORAS Y HORARIOS', ['ASESORA', 'DESDE', 'HASTA', 'MAXIMO DIARIO', 'DESBORDE', 'ACTIVA', 'CALENDARIO ID', 'VIGENTE DESDE', 'VIGENTE HASTA'], [
      ['MAINET', '11:00', '13:00', '', '', 'SI', '', '', ''],
      ['ANTONELLA', '18:00', '22:00', '', '', 'SI', '', '', ''],
    ]);
    LISTA_(asesoras, 6, ['SI', 'NO']);
    if (!ss.getSheetByName('CUADRO DE INICIOS')) CREAR_TABLA_(ss, 'CUADRO DE INICIOS', ['ID DE INICIO', 'CURSO', 'MODULO', 'FECHA DE INICIO', 'ACTIVO'], []);
    else TABLA_('CUADRO DE INICIOS');
    const validaciones = CREAR_TABLA_(ss, 'VALIDACIONES', ['N°', 'DECISION', 'OBSERVACION', 'DNI ARCHIVO ID', 'VOUCHER ARCHIVO ID', 'BOLETA ARCHIVO ID', 'CRONOGRAMA ARCHIVO ID', 'FICHA ARCHIVO ID'], []);
    LISTA_(validaciones, 2, ['PENDIENTE', 'VALIDADO', 'NO VALIDADO', 'EN OBSERVACION']);
    CREAR_TABLA_(ss, 'PENDIENTES WHATSAPP', ['N°', 'CURSO', 'ID DE INICIO', 'FECHA DE INICIO', 'ASESORA', 'NOMBRE COMPLETO', 'CELULAR 1', 'CELULAR 2', 'PRIORIDAD'], []);
    // Only our periodic trigger is replaced; other installed triggers are preserved.
    ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'ACTUALIZAR_MATRICULAS_V2'; }).forEach(function (t) { ScriptApp.deleteTrigger(t); });
    ScriptApp.newTrigger('ACTUALIZAR_MATRICULAS_V2').timeBased().everyMinutes(10).create();
    ss.toast('V2 INSTALADA. CONFIGURA HORARIOS, CARPETA E INICIOS.', 'MATRICULAS', 10);
  });
}
function MINUTOS_(v) {
  if (v instanceof Date) v = Utilities.formatDate(v, V2.tz, 'HH:mm');
  const x = /^(\d{2}):(\d{2})$/.exec(TEXTO_(v));
  return x && Number(x[1]) < 24 && Number(x[2]) < 60 ? Number(x[1]) * 60 + Number(x[2]) : null;
}
function EDAD_(fecha, hoy) {
  const a = DIA_(fecha), b = DIA_(hoy); if (!a || a > b) return '';
  return Number(b.slice(0, 4)) - Number(a.slice(0, 4)) - (b.slice(5) < a.slice(5) ? 1 : 0);
}
function PRIORIDAD_(fecha, hoy, alta, media) {
  const a = DIA_(fecha), b = DIA_(hoy); if (!a || !b) return '';
  const dias = Math.round((Date.parse(a) - Date.parse(b)) / 86400000);
  return dias <= alta ? 'ALTA' : dias <= media ? 'MEDIA' : 'BAJA';
}
function LIMPIAR_IDENTIFICADOR_(valor, telefono) {
  let x = TEXTO_(valor).replace(/\s+/g, '').toUpperCase();
  if (telefono) x = x.replace(/[()\-]/g, '');
  return x;
}
function ERRORES_DATOS_(tipo, documento, telefono1, telefono2, correo) {
  const r = [];
  if (documento && !tipo) r.push('SELECCIONAR TIPO DE DOCUMENTO');
  if (tipo && ['DNI', 'CARNE DE EXTRANJERIA', 'PASAPORTE', 'OTRO'].indexOf(tipo) === -1) r.push('TIPO DE DOCUMENTO INVALIDO');
  if (tipo === 'DNI' && documento && !/^\d+$/.test(documento)) r.push('DNI DEBE CONTENER SOLO NUMEROS');
  if (documento && !/^[A-Z0-9]+$/.test(documento)) r.push('REVISAR CARACTERES DEL DOCUMENTO');
  [telefono1, telefono2].forEach(function (v, i) { if (v && !/^\+?\d+$/.test(v)) r.push('REVISAR CELULAR ' + (i + 1)); });
  if (correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) r.push('REVISAR CORREO');
  else if (correo && !/@gmail\.com$/i.test(correo)) r.push('CORREO NO ES GMAIL');
  return r;
}
function ELEGIR_ASESORA_(fecha, hora, reglas, conteos, fuera) {
  const minuto = MINUTOS_(hora), dia = DIA_(fecha); if (minuto === null || !dia) return '';
  const candidatas = reglas.filter(function (r) {
    const desde = MINUTOS_(r[1]), hasta = MINUTOS_(r[2]);
    return CLAVE_(r[5]) === 'SI' && desde !== null && hasta !== null && desde < hasta && minuto >= desde && minuto < hasta && (!r[7] || DIA_(r[7]) <= dia) && (!r[8] || DIA_(r[8]) >= dia);
  });
  if (candidatas.length > 1) throw new Error('HORARIOS SUPERPUESTOS');
  if (!candidatas.length) return CLAVE_(fuera);
  const r = candidatas[0], nombre = CLAVE_(r[0]), limite = Number(r[3]);
  if (r[3] === '') return ''; // La capacidad debe quedar definida antes de asignar.
  if (r[3] !== '' && (!Number.isInteger(limite) || limite < 1)) throw new Error('MAXIMO DIARIO INVALIDO');
  if (r[3] !== '' && (conteos[dia + '|' + nombre] || 0) >= limite) {
    const desborde = CLAVE_(r[4]);
    const destino = reglas.find(function (x) { return CLAVE_(x[0]) === desborde && CLAVE_(x[5]) === 'SI' && (!x[7] || DIA_(x[7]) <= dia) && (!x[8] || DIA_(x[8]) >= dia); });
    if (!destino) return '';
    const max = Number(destino[3]);
    if (destino[3] !== '' && (!Number.isInteger(max) || max < 1 || (conteos[dia + '|' + desborde] || 0) >= max)) return '';
    return desborde;
  }
  return nombre;
}
function PROCESAR_FILAS_V2_(s, desde, cantidad, c1, c2, ahora) {
  const m = MAPA_(s), n = s.getLastColumn();
  if (!m['TIPO DE DOCUMENTO'] || !m['NUMERO DE DOCUMENTO']) throw new Error('EJECUTAR INSTALAR_MATRICULAS_V2');
  const opciones = OPCIONES_(), reglas = TABLA_('ASESORAS Y HORARIOS'), inicios = TABLA_('CUADRO DE INICIOS');
  const all = s.getLastRow() < 2 ? [] : s.getRange(2, 1, s.getLastRow() - 1, n).getValues();
  let siguiente = all.reduce(function (max, r) { const x = Number(r[m['N°'] - 1]); return Number.isSafeInteger(x) && x > max ? x : max; }, 0) + 1;
  const conteos = {};
  all.forEach(function (r) { const k = DIA_(r[m['FECHA DE HOY'] - 1]) + '|' + CLAVE_(r[m['ASESORA DE INGRESO'] - 1]); if (r[m['NOMBRE COMPLETO'] - 1] && r[m['ASESORA DE INGRESO'] - 1]) conteos[k] = (conteos[k] || 0) + 1; });
  for (let fila = desde; fila < desde + cantidad; fila++) {
    const row = s.getRange(fila, 1, 1, n).getValues()[0], formulas = s.getRange(fila, 1, 1, n).getFormulas()[0];
    const get = function (k) { return m[k] ? row[m[k] - 1] : ''; };
    const put = function (k, v) {
      const c = m[k]; if (!c || formulas[c - 1] || row[c - 1] === v) return;
      const cell = s.getRange(fila, c), rule = cell.getDataValidation();
      if (v !== '' && rule && String(rule.getCriteriaType()) === 'VALUE_IN_LIST') {
        const allowed = rule.getCriteriaValues()[0];
        if (allowed.indexOf(v) === -1) {
          const matches = allowed.filter(function (x) { return CLAVE_(x) === CLAVE_(v); });
          if (matches.length !== 1) { NOTA_AUTOMATICA_(cell, 'VALOR NO ADMITIDO POR LA LISTA: ' + v); return; }
          v = matches[0];
        }
      }
      cell.setValue(v); row[c - 1] = v;
    };
    Object.keys(m).forEach(function (k) {
      const c = m[k], v = get(k); if (c < c1 || c > c2 || formulas[c - 1] || typeof v !== 'string') return;
      if (k === 'NUMERO DE DOCUMENTO') put(k, LIMPIAR_IDENTIFICADOR_(v, false));
      else if (/^CELULAR [12]$/.test(k)) put(k, LIMPIAR_IDENTIFICADOR_(v, true));
      else if (k === 'CORREO ELECTRONICO') put(k, v.trim().toLowerCase());
      else if (k !== 'LINK DE CARPETA DEL ESTUDIANTE') put(k, TEXTO_(v).toUpperCase());
    });
    if (!TEXTO_(get('NOMBRE COMPLETO'))) continue;
    if (get('N°') === '') put('N°', siguiente++);
    if (get('FECHA DE HOY') === '' && !formulas[m['FECHA DE HOY'] - 1]) { put('FECHA DE HOY', ahora); if (get('HORA') === '') put('HORA', ahora); }
    if (!get('INSTITUTO')) put('INSTITUTO', 'INSTICRECE');
    s.getRange(fila, m['FECHA DE HOY']).setNumberFormat('dd/MM/yyyy'); s.getRange(fila, m.HORA).setNumberFormat('HH:mm:ss');
    if (m.EDAD) put('EDAD', EDAD_(get('F. NACIMIENTO'), ahora));
    const id = TEXTO_(get('ID DE INICIO'));
    if (id) {
      const coincidencias = inicios.filter(function (x) { return TEXTO_(x[0]) === id && CLAVE_(x[4]) === 'SI'; });
      if (coincidencias.length === 1 && CLAVE_(coincidencias[0][1]) === CLAVE_(get('CURSO')) && DIA_(coincidencias[0][3])) put('FECHA DE INICIO', coincidencias[0][3]);
      else s.getRange(fila, m['ID DE INICIO']).setNote('REVISAR ID, CURSO O FECHA: NO HAY UN INICIO UNICO ACTIVO');
    }
    const alta = Number(opciones['PRIORIDAD ALTA DIAS']), media = Number(opciones['PRIORIDAD MEDIA DIAS']);
    if (!Number.isFinite(alta) || !Number.isFinite(media) || alta < 0 || media < alta) throw new Error('UMBRAL DE PRIORIDAD INVALIDO');
    put('PRIORIDAD', PRIORIDAD_(get('FECHA DE INICIO'), ahora, alta, media));
    const realizado = get('AGREGADOS AL WHATSAPP') === true || ['SI', 'AGREGADO', 'REALIZADO'].indexOf(CLAVE_(get('AGREGADOS AL WHATSAPP'))) !== -1;
    if (realizado) put('ESTADO', 'REALIZADO'); else if (!get('ESTADO') || CLAVE_(get('ESTADO')) === 'REALIZADO') put('ESTADO', 'NO REALIZADO');
    if (!get('ASESORA DE INGRESO')) {
      const elegida = ELEGIR_ASESORA_(get('FECHA DE HOY'), get('HORA'), reglas, conteos, opciones['FUERA DE HORARIO']);
      if (elegida) { put('ASESORA DE INGRESO', elegida); const key = DIA_(get('FECHA DE HOY')) + '|' + elegida; conteos[key] = (conteos[key] || 0) + 1; }
    }
    const errores = ERRORES_DATOS_(CLAVE_(get('TIPO DE DOCUMENTO')), get('NUMERO DE DOCUMENTO'), get('CELULAR 1'), get('CELULAR 2'), get('CORREO ELECTRONICO'));
    NOTA_AUTOMATICA_(s.getRange(fila, m.OBSERVACIONES), errores.join('\n'));
  }
}
// La edicion entre libros necesita un activador autorizado, no un onEdit simple.
function onEdit(e) { return; }
function EDITAR_MATRICULAS_AUTORIZADO(e) {
  if (!e || !e.range || e.source.getId() !== V2.id || e.range.getSheet().getName() !== 'MATRICULAS' || e.range.getLastRow() < 2) return;
  const ahora = new Date();
  BLOQUEO_(function () { PROCESAR_FILAS_V2_(e.range.getSheet(), Math.max(2, e.range.getRow()), e.range.getLastRow() - Math.max(2, e.range.getRow()) + 1, e.range.getColumn(), e.range.getLastColumn(), ahora); });
}
function NOTA_AUTOMATICA_(celda, mensaje) {
  const anterior = celda.getNote().split('\n[AUTOMATIZACION]\n')[0];
  celda.setNote(anterior + (mensaje ? '\n[AUTOMATIZACION]\n' + mensaje : ''));
}
function PROCESAR_REGISTRO_AUTOMATICO(fila) {
  return BLOQUEO_(function () { const s = HOJA_('MATRICULAS'); if (!Number.isSafeInteger(fila) || fila < 2 || fila > s.getLastRow()) throw new Error('FILA INVALIDA'); PROCESAR_FILAS_V2_(s, fila, 1, 1, s.getLastColumn(), new Date()); return s.getRange(fila, 1, 1, 3).getValues()[0]; });
}
function CARPETA_UNICA_(padre, nombre) {
  const it = padre.getFoldersByName(nombre); if (!it.hasNext()) return padre.createFolder(nombre);
  const f = it.next(); if (it.hasNext()) throw new Error('CARPETA DUPLICADA: ' + nombre); return f;
}
function ID_DRIVE_(v) { const x = TEXTO_(v); const match = /\/folders\/([\w-]+)|\/d\/([\w-]+)/.exec(x); return match ? match[1] || match[2] : /^[\w-]+$/.test(x) ? x : ''; }
function RUTA_ESTUDIANTE_(fecha, nombre, documento, curso) {
  if (!DIA_(fecha) || !nombre || !documento || !curso) throw new Error('FALTAN DATOS PARA CREAR CARPETA');
  return [Utilities.formatDate(fecha, V2.tz, 'M-yyyy'), Utilities.formatDate(fecha, V2.tz, 'd-M'), CLAVE_(nombre) + '-' + documento, CLAVE_(curso), 'PRIMER PAGO'];
}
function VERIFICAR_IDENTIDAD_CARPETA_(nombreCarpeta, nombre, documento) {
  const esperado = CLAVE_(nombre) + '-' + LIMPIAR_IDENTIFICADOR_(documento, false);
  if (CLAVE_(nombreCarpeta) !== esperado) throw new Error('NOMBRE Y DOCUMENTO NO COINCIDEN CON LA CARPETA EXISTENTE');
}
function CARPETAS_Y_ARCHIVOS_(s, opciones) {
  const rootId = ID_DRIVE_(opciones['CARPETA GENERAL ID']); if (!rootId) return;
  const root = DriveApp.getFolderById(rootId), m = MAPA_(s), props = PropertiesService.getScriptProperties();
  const hoy = new Date(), fin = new Date(Utilities.formatDate(hoy, V2.tz, 'yyyy-MM') + '-01T12:00:00-05:00'); fin.setUTCMonth(fin.getUTCMonth() + 1);
  CARPETA_UNICA_(root, Utilities.formatDate(hoy, V2.tz, 'M-yyyy'));
  if ((Date.parse(DIA_(fin)) - Date.parse(DIA_(hoy))) / 86400000 <= 5) CARPETA_UNICA_(root, Utilities.formatDate(fin, V2.tz, 'M-yyyy'));
  const decisiones = TABLA_('VALIDACIONES'), rows = s.getLastRow() < 2 ? [] : s.getRange(2, 1, s.getLastRow() - 1, s.getLastColumn()).getValues();
  rows.forEach(function (r, i) {
    const get = function (k) { return r[m[k] - 1]; }, num = get('N°');
    const v = decisiones.filter(function (x) { return String(x[0]) === String(num); });
    if (v.length !== 1 || CLAVE_(v[0][1]) !== 'VALIDADO') return;
    const doc = TEXTO_(get('NUMERO DE DOCUMENTO')), tipo = CLAVE_(get('TIPO DE DOCUMENTO'));
    if (!tipo || !doc || ERRORES_DATOS_(tipo, doc, '', '', '').length) return;
    try {
      const ruta = RUTA_ESTUDIANTE_(get('FECHA DE HOY'), get('NOMBRE COMPLETO'), doc, get('CURSO'));
      const key = 'ALUMNO:' + rootId + ':' + tipo + ':' + doc;
      let estudiante;
      if (props.getProperty(key)) {
        estudiante = DriveApp.getFolderById(props.getProperty(key));
        VERIFICAR_IDENTIDAD_CARPETA_(estudiante.getName(), get('NOMBRE COMPLETO'), doc);
      }
      else { estudiante = CARPETA_UNICA_(CARPETA_UNICA_(CARPETA_UNICA_(root, ruta[0]), ruta[1]), ruta[2]); props.setProperty(key, estudiante.getId()); }
      const pago = CARPETA_UNICA_(CARPETA_UNICA_(estudiante, ruta[3]), ruta[4]);
      s.getRange(i + 2, m['LINK DE CARPETA DEL ESTUDIANTE']).setValue(estudiante.getUrl());
      ['DOCUMENTO', 'VOUCHER', 'BOLETA', 'CRONOGRAMA', 'FICHA'].forEach(function (nombre, j) {
        const id = ID_DRIVE_(v[0][j + 3]); if (!id) return;
        const fileKey = 'ARCHIVO:' + pago.getId() + ':' + id;
        if (props.getProperty(fileKey)) return;
        const archivo = DriveApp.getFileById(id), destino = nombre + '-' + id + '-' + CLAVE_(archivo.getName());
        const existentes = pago.getFilesByName(destino);
        const copia = existentes.hasNext() ? existentes.next() : archivo.makeCopy(destino, pago);
        props.setProperty(fileKey, copia.getId());
      });
    } catch (error) { s.getRange(i + 2, m['LINK DE CARPETA DEL ESTUDIANTE']).setNote('REVISAR CARPETA: ' + error.message); }
  });
}
function PENDIENTES_(s) {
  const m = MAPA_(s), rows = s.getLastRow() < 2 ? [] : s.getRange(2, 1, s.getLastRow() - 1, s.getLastColumn()).getValues();
  return rows.filter(function (r) { return r[m['NOMBRE COMPLETO'] - 1] && CLAVE_(r[m.ESTADO - 1]) !== 'REALIZADO'; }).map(function (r) { return ['N°', 'CURSO', 'ID DE INICIO', 'FECHA DE INICIO', 'ASESORA DE INGRESO', 'NOMBRE COMPLETO', 'CELULAR 1', 'CELULAR 2', 'PRIORIDAD'].map(function (k) { return r[m[k] - 1]; }); }).sort(function (a, b) { const p = { ALTA: 0, MEDIA: 1, BAJA: 2 }; return (p[a[8]] == null ? 3 : p[a[8]]) - (p[b[8]] == null ? 3 : p[b[8]]) || DIA_(a[3]).localeCompare(DIA_(b[3])); });
}
function ACTUALIZAR_MATRICULAS_V2() {
  BLOQUEO_(function () {
    RESALTAR_CUADROS_INICIOS_(new Date());
    const s = HOJA_('MATRICULAS'); if (s.getLastRow() >= 2) PROCESAR_FILAS_V2_(s, 2, s.getLastRow() - 1, 1, 0, new Date());
    const lista = PENDIENTES_(s), destino = HOJA_('PENDIENTES WHATSAPP');
    if (destino.getLastRow() > 1) destino.getRange(2, 1, destino.getLastRow() - 1, 9).clearContent();
    if (lista.length) { if (destino.getMaxRows() < lista.length + 1) destino.insertRowsAfter(destino.getMaxRows(), lista.length + 1 - destino.getMaxRows()); destino.getRange(2, 7, lista.length, 2).setNumberFormat('@'); destino.getRange(2, 1, lista.length, 9).setValues(lista); destino.getRange(2, 4, lista.length, 1).setNumberFormat('dd/MM/yyyy'); }
    CARPETAS_Y_ARCHIVOS_(s, OPCIONES_());
    SINCRONIZAR_CALENDARIOS_(lista, OPCIONES_());
  });
}
/** Calendarios configurados y con permiso de escritura; no envia invitaciones. */
function SINCRONIZAR_CALENDARIOS_(lista, opciones) {
  if (CLAVE_(opciones['CALENDARIO ACTIVO']) !== 'SI') return;
  const hora = TEXTO_(opciones['HORA AVISO']); if (MINUTOS_(hora) === null) throw new Error('CONFIGURAR HORA AVISO');
  const grupos = {}, reglas = TABLA_('ASESORAS Y HORARIOS'), props = PropertiesService.getScriptProperties();
  lista.forEach(function (r) {
    if (!r[2] || !DIA_(r[3]) || !r[4]) return;
    const key = CLAVE_(r[4]) + '|' + TEXTO_(r[2]);
    if (!grupos[key]) grupos[key] = { asesora: CLAVE_(r[4]), inicio: r[3], curso: r[1], cantidad: 0 };
    grupos[key].cantidad++;
  });
  const activos = {};
  Object.keys(grupos).forEach(function (k) {
    const g = grupos[k], asesoras = reglas.filter(function (r) { return CLAVE_(r[0]) === g.asesora && TEXTO_(r[6]); });
    if (asesoras.length !== 1) return;
    const cid = TEXTO_(asesoras[0][6]), cal = CalendarApp.getCalendarById(cid); if (!cal) throw new Error('SIN ACCESO AL CALENDARIO DE ' + g.asesora);
    const start = new Date(DIA_(g.inicio) + 'T' + hora + ':00-05:00'), end = new Date(start.getTime() + 30 * 60000);
    const key = 'CALENDARIO:' + cid + ':' + k, titulo = 'AGREGAR A WHATSAPP - ' + CLAVE_(g.curso);
    const descripcion = g.cantidad + ' ESTUDIANTES PENDIENTES. CONSULTAR PENDIENTES WHATSAPP EN:\nhttps://docs.google.com/spreadsheets/d/' + V2.id + '/edit';
    const saved = props.getProperty(key); let event = saved ? cal.getEventById(saved) : null;
    if (!event && start < new Date()) return;
    if (!event) { event = cal.createEvent(titulo, start, end, { description: descripcion }); props.setProperty(key, event.getId()); event.addPopupReminder(5); }
    else { event.setTitle(titulo).setTime(start, end).setDescription(descripcion); }
    activos[key] = true;
  });
  // Remove only events this script created, when the list is completed.
  const conocidas = props.getProperties();
  Object.keys(conocidas).filter(function (k) { return k.indexOf('CALENDARIO:') === 0 && !activos[k]; }).forEach(function (k) {
    const cid = k.slice('CALENDARIO:'.length).split(':')[0];
    if (!reglas.some(function (r) { return TEXTO_(r[6]) === cid; })) return;
    const cal = CalendarApp.getCalendarById(cid), event = cal && cal.getEventById(conocidas[k]);
    if (event) event.deleteEvent(); props.deleteProperty(k);
  });
}

function INSTALAR_EDICION_MATRIZ() {
  ['CONFIGURACION', 'ASESORAS Y HORARIOS', 'VALIDACIONES', 'PENDIENTES WHATSAPP'].forEach(HOJA_);
  if (!ScriptApp.getProjectTriggers().some(function(t) { return t.getHandlerFunction() === 'EDITAR_MATRICULAS_AUTORIZADO'; })) ScriptApp.newTrigger('EDITAR_MATRICULAS_AUTORIZADO').forSpreadsheet(V2.id).onEdit().create();
  console.log('MATRIZ CONECTADA Y EDICION AUTORIZADA INSTALADA');
}
