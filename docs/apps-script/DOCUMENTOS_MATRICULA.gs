/** Instalar junto al boton original de Boletas para compartir bloqueo y contador. */
const DOC = {
  admin: '12qF1Y0X4PjY6YtnWJG7NyQ15cWmXK9fW-7gMWKJxLQc',
  libro: '16jhqgiYLh_GCkuxPL2fpljf04-Pj2HAqNY_0ePT0z7w',
  raiz: '1ShHqu1pe_yqZd42hnLTZkMgj49OtMMSY', tz: 'America/Lima',
  boleta: '1OUGzpD8t-NAWGtpPrndS9V5jBKqrreo6oP4Dc_skAfU',
  cronograma: '1RUIFUmIMTOpWxwHN2VacWtjdb49pH2nLEL-MlMdIzmk',
  ficha: '1DwfN_1Ck9eLSpY-RbYMezSPEv9IXwzXgU84_4SeMk4c'
};
function D_TEXTO(v) { return String(v == null ? '' : v).trim().replace(/\s+/g, ' '); }
function D_CLAVE(v) { return D_TEXTO(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase(); }
function D_DIA(v) {
  if (v instanceof Date && !isNaN(v)) return Utilities.formatDate(v, DOC.tz, 'yyyy-MM-dd');
  const x = D_TEXTO(v); if (!/^\d{4}-\d{2}-\d{2}$/.test(x)) throw new Error('FECHA INVALIDA');
  const d = new Date(x + 'T12:00:00-05:00');
  if (isNaN(d) || Utilities.formatDate(d, DOC.tz, 'yyyy-MM-dd') !== x) throw new Error('FECHA INVALIDA');
  return x;
}
function D_FECHA(v) { return new Date(D_DIA(v) + 'T12:00:00-05:00'); }
function D_MONTO(v) {
  if (v === '' || v == null || typeof v === 'boolean') throw new Error('FALTA MONTO');
  const n = Number(v); if (!Number.isFinite(n) || n < 0 || Math.abs(n * 100 - Math.round(n * 100)) > 0.000001) throw new Error('MONTO INVALIDO');
  return Math.round(n * 100) / 100;
}
function D_VENCIMIENTOS(inicio) {
  const iso = D_DIA(inicio), y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7)) - 1, d = Number(iso.slice(8));
  return Array.from({ length: 5 }, function (_, i) {
    const mes = m + (d <= 9 ? 0 : 1) + i, dia = d >= 10 && d <= 25 ? 15 : 30;
    const ultimo = new Date(Date.UTC(y, mes + 1, 0)).getUTCDate();
    return new Date(Date.UTC(y, mes, Math.min(dia, ultimo), 17)).toISOString().slice(0, 10);
  });
}
function D_IGV(total) { const t = D_MONTO(total), base = Math.round(t / 1.18 * 100) / 100; return { base: base, igv: Math.round((t - base) * 100) / 100, total: t }; }
function D_BLOQUEO(fn) { const l = LockService.getScriptLock(); l.waitLock(20000); try { return fn(); } finally { l.releaseLock(); } }
function D_LIBRO() { return SpreadsheetApp.openById(DOC.admin); }
function D_TABLA(nombre, headers, seed) {
  const ss = D_LIBRO(); let s = ss.getSheetByName(nombre);
  if (!s) { s = ss.insertSheet(nombre); s.getRange(1, 1, 1, headers.length).setValues([headers]); if (seed && seed.length) s.getRange(2, 1, seed.length, headers.length).setValues(seed); }
  if (s.getRange(1, 1, 1, headers.length).getValues()[0].map(D_CLAVE).join('|') !== headers.join('|')) throw new Error('REVISAR ' + nombre);
  s.setFrozenRows(1); s.getRange(1, 1, 1, headers.length).setFontWeight('bold').setWrap(true);
  return s;
}
function INSTALAR_DOCUMENTOS_MATRICULA() {
  D_BLOQUEO(function () {
    const p = D_TABLA('PROMOCIONES', ['ID PROMO', 'NOMBRE', 'ACTIVA', 'PRIMER MES', 'MES 2', 'MES 3', 'MES 4', 'MES 5', 'MES 6'], [['PROMO 001', 'PRIMER MES 19.90 Y CINCO CUOTAS 79.90', 'SI', 19.9, 79.9, 79.9, 79.9, 79.9, 79.9]]);
    p.getRange(2, 3, p.getMaxRows() - 1, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['SI', 'NO'], true).setAllowInvalid(false).build());
    p.getRange(2, 4, p.getMaxRows() - 1, 6).setNumberFormat('0.00');
    D_TABLA('PAGOS DE MATRICULA', ['N°', 'ID PROMO', 'FECHA DE PAGO', 'MONTO PAGADO', 'METODO DE PAGO', 'ID INTERESADO CRM'], []);
    D_TABLA('DOCUMENTOS GENERADOS', ['N°', 'ID PROMO', 'PRIMER MES', 'MES 2', 'MES 3', 'MES 4', 'MES 5', 'MES 6', 'FECHA DE PAGO', 'MONTO PAGADO', 'FECHA DE EMISION', 'NUMERO BOLETA', 'BOLETA PDF', 'CRONOGRAMA PDF', 'FICHA PDF', 'ESTADO', 'OBSERVACION'], []);
    if (!ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'GENERAR_DOCUMENTOS_PENDIENTES'; })) ScriptApp.newTrigger('GENERAR_DOCUMENTOS_PENDIENTES').timeBased().everyMinutes(10).create();
    console.log('DOCUMENTOS INSTALADOS. SOLO PROCESA PAGOS CON VALIDACION HUMANA Y PROMOCION EXPLICITA.');
  });
}
function D_FILAS(s) { return s && s.getLastRow() > 1 ? s.getRange(2, 1, s.getLastRow() - 1, s.getLastColumn()).getValues() : []; }
function D_UNICO(rows, numero) { const a = rows.filter(function (r) { return D_TEXTO(r[0]) === D_TEXTO(numero); }); if (a.length !== 1) throw new Error('REGISTRO AUSENTE O DUPLICADO'); return a[0]; }
function D_PROMO(id) {
  const r = D_UNICO(D_FILAS(D_LIBRO().getSheetByName('PROMOCIONES')), id);
  if (D_CLAVE(r[2]) !== 'SI') throw new Error('PROMOCION INACTIVA');
  return { id: D_CLAVE(r[0]), precios: r.slice(3, 9).map(D_MONTO) };
}
/** Llamar al ofrecer la promocion; la conexion del CRM debe pasar ID, no inferir precios. */
function REGISTRAR_OFERTA_DOCUMENTAL(claveInteresado, idPromo) {
  return D_BLOQUEO(function () {
    if (!D_TEXTO(claveInteresado)) throw new Error('FALTA INTERESADO');
    const p = D_PROMO(idPromo); p.ofrecidaEn = new Date().toISOString();
    PropertiesService.getScriptProperties().setProperty('OFERTA:' + D_TEXTO(claveInteresado) + ':' + p.id, JSON.stringify(p)); return p;
  });
}
function D_DATOS(numero) {
  const ss = D_LIBRO(), s = SpreadsheetApp.openById(DOC.libro).getSheetByName('MATRICULAS');
  const h = s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0].map(D_CLAVE), r = D_UNICO(D_FILAS(s), numero), get = function (k) { const i = h.indexOf(k); return i < 0 ? '' : r[i]; };
  const validacion = D_UNICO(D_FILAS(ss.getSheetByName('VALIDACIONES')), numero);
  if (D_CLAVE(validacion[1]) !== 'VALIDADO') throw new Error('PAGO SIN VALIDAR');
  const pago = D_UNICO(D_FILAS(ss.getSheetByName('PAGOS DE MATRICULA')), numero);
  const nombre = D_TEXTO(get('NOMBRE COMPLETO')).toUpperCase(), tipo = D_CLAVE(get('TIPO DE DOCUMENTO')), doc = D_CLAVE(get('NUMERO DE DOCUMENTO')).replace(/\s/g, '');
  if (!nombre || !['DNI', 'CARNE DE EXTRANJERIA', 'PASAPORTE', 'OTRO'].includes(tipo) || !/^[A-Z0-9]+$/.test(doc) || (tipo === 'DNI' && !/^\d{8}$/.test(doc))) throw new Error('REVISAR IDENTIDAD');
  const curso = D_TEXTO(get('CURSO')).toUpperCase(); if (!curso) throw new Error('FALTA CURSO');
  const folderUrl = D_TEXTO(get('LINK DE CARPETA DEL ESTUDIANTE')), match = /\/folders\/([\w-]+)/.exec(folderUrl);
  if (!match) throw new Error('ESPERANDO CARPETA DEL ESTUDIANTE');
  const folder = DriveApp.getFolderById(match[1]); if (D_CLAVE(folder.getName()) !== D_CLAVE(nombre) + '-' + doc) throw new Error('CARPETA NO COINCIDE CON IDENTIDAD');
  let ancestor = folder, enRaiz = false;
  for (let i = 0; i < 5; i++) { if (ancestor.getId() === DOC.raiz) { enRaiz = true; break; } const parents = ancestor.getParents(); if (!parents.hasNext()) break; ancestor = parents.next(); }
  if (!enRaiz) throw new Error('CARPETA FUERA DE ALUMNOS INSTICRECE GENERAL');
  const props = PropertiesService.getScriptProperties(), key = 'MATRICULA DOC:' + D_TEXTO(numero), saved = props.getProperty(key);
  if (saved) { const snap = JSON.parse(saved); if (snap.nombre !== nombre || snap.doc !== doc || snap.tipo !== tipo || snap.curso !== curso) throw new Error('CAMBIO DE IDENTIDAD O CURSO: REVISAR'); return snap; }
  const oferta = pago[6] || (pago[5] ? props.getProperty('OFERTA:' + D_TEXTO(pago[5]) + ':' + D_CLAVE(pago[1])) : '');
  if (pago[5] && !oferta) throw new Error('NO CONSTA LA OFERTA DE ESTE INTERESADO');
  const promo = oferta ? JSON.parse(oferta) : D_PROMO(pago[1]);
  if (D_CLAVE(promo.id) !== D_CLAVE(pago[1]) || (pago[6] && promo.confirmadaEnCRM !== pago[5])) throw new Error('OFERTA CONFIRMADA NO CORRESPONDE A ESTA MATRICULA');
  if (!Array.isArray(promo.precios) || promo.precios.length !== 6) throw new Error('PROMOCION INCOMPLETA');
  promo.precios = promo.precios.map(D_MONTO);
  if (D_TEXTO(get('PROMO')) && D_CLAVE(get('PROMO')) !== promo.id) throw new Error('PROMO DE MATRICULA Y PAGO NO COINCIDEN');
  const monto = D_MONTO(pago[3]); if (monto !== promo.precios[0]) throw new Error('PAGO PARCIAL O DIFERENTE: REQUIERE REVISION ANTES DEL CRONOGRAMA');
  const x = { numero: D_TEXTO(numero), nombre: nombre, tipo: tipo, doc: doc, curso: curso, inicio: D_DIA(get('FECHA DE INICIO')), pago: D_DIA(pago[2]), monto: monto, metodo: D_CLAVE(pago[4]), promo: promo, emision: D_DIA(new Date()), nacimiento: get('F. NACIMIENTO') ? D_DIA(get('F. NACIMIENTO')) : '', direccion: D_TEXTO(get('DIRECCION')).toUpperCase(), departamento: D_TEXTO(get('DEPARTAMENTO')).toUpperCase(), celulares: [get('CELULAR 1'), get('CELULAR 2')].map(D_TEXTO).filter(Boolean).join(' / '), correo: D_TEXTO(get('CORREO ELECTRONICO')), estudianteId: folder.getId() };
  if (!x.celulares || !x.correo || !x.metodo) throw new Error('FALTAN CELULAR, CORREO O METODO DE PAGO');
  props.setProperty(key, JSON.stringify(x)); return x;
}
function D_CARPETA(padre, nombre) { const it = padre.getFoldersByName(nombre); if (!it.hasNext()) return padre.createFolder(nombre); const f = it.next(); if (it.hasNext()) throw new Error('CARPETA DUPLICADA'); return f; }
function D_NUMERO() {
  const cell = SpreadsheetApp.openById(DOC.boleta).getSheetByName('ÁREA ACADÉMICA').getRange('T62'), n = Number(cell.getValue());
  if (!Number.isSafeInteger(n) || n < 1) throw new Error('CONTADOR B002 INVALIDO');
  cell.setValue(n + 1); SpreadsheetApp.flush(); return n;
}
function D_PONER(s, celda, valor, formato) { const c = s.getRange(celda); if (formato) c.setNumberFormat(formato); c.setValue(valor); }
function D_METODO(valor) {
  const opciones = { 'YAPE': 'Yape/Plin', 'PLIN': 'Yape/Plin', 'YAPE/PLIN': 'Yape/Plin', 'TRANSFERENCIA': 'Tranferencia/Depósito', 'DEPOSITO': 'Tranferencia/Depósito', 'TRANSFERENCIA/DEPOSITO': 'Tranferencia/Depósito', 'TRANFERENCIA/DEPOSITO': 'Tranferencia/Depósito', 'EFECTIVO': 'Efectivo', 'MERCADO PAGO': 'Mercado Pago' };
  const metodo = opciones[D_CLAVE(valor)];
  if (!metodo) throw new Error('METODO DE PAGO NO RECONOCIDO: ' + D_TEXTO(valor));
  return metodo;
}
function D_LLENAR(s, tipo, x, serie) {
  const put = function (c, v, f) { D_PONER(s, c, v, f); }, fechas = D_VENCIMIENTOS(x.inicio);
  if (tipo === 'BOLETA') {
    put('E10', x.nombre, '@'); put('E11', x.doc, '@'); put('B11', x.tipo); put('B15', D_FECHA(x.emision), 'dd/MM/yyyy');
    put('M15', D_METODO(x.metodo)); put('B18', 1); put('E18', 'PRIMERA CUOTA - ' + D_CURSO_VISIBLE(x.curso)); put('M18', x.promo.precios[0]);
    s.getRange('O18').setFormula('=ROUND(M18*B18,2)'); s.getRange('O56').setFormula('=O18');
    put('O57', x.monto < x.promo.precios[0] ? x.monto : 0); put('O58', x.monto);
    s.getRange('O59').setFormula('=ROUND(O56-O58,2)'); s.getRange('O62').setFormula('=O58');
    s.getRange('O60').setFormula('=ROUND(O62/1.18,2)'); s.getRange('O61').setFormula('=ROUND(O62-O60,2)');
    put('M6', serie); put('T62', serie); s.getRange('O56:O62').setNumberFormat('0.00');
  } else if (tipo === 'CRONOGRAMA') {
    put('E11', x.nombre); put('E12', x.doc, '@'); put('B12', x.tipo + ':'); put('E13', D_CURSO_VISIBLE(x.curso)); put('E14', D_FECHA(x.inicio), 'dd/MM/yyyy');
    put('E15', x.celulares, '@'); put('E16', 'PERIODO DE 6 MESES'); put('E17', x.correo);
    for (let i = 0; i < 6; i++) { put('E' + (21 + i), D_CURSO_VISIBLE(x.curso)); put('F' + (21 + i), D_FECHA(i ? fechas[i - 1] : x.pago), 'dd/MM/yyyy'); put('G' + (21 + i), i ? x.promo.precios[i] : x.monto, '"S/ "0.00'); }
  } else {
    put('F15', x.nombre); put('F16', x.doc, '@'); put('B16', x.tipo); put('F17', x.nacimiento ? D_FECHA(x.nacimiento) : 'PENDIENTE', x.nacimiento ? 'dd/MM/yyyy' : '@');
    put('F18', x.direccion || 'PENDIENTE'); put('F19', x.departamento || 'PENDIENTE'); put('F20', x.celulares, '@'); put('F21', x.correo); put('F25', D_CURSO_VISIBLE(x.curso));
    put('F26', 0); put('F27', x.promo.precios[1]);
  }
}
function D_CURSO_VISIBLE(curso) {
  return D_CLAVE(curso).replace(/\b(\d{1,2})-(\d{1,2})$/, function (_, a, b) {
    const hora = function (h) { const n = Number(h); if (n > 23) throw new Error('HORARIO INVALIDO'); return (n % 12 || 12) + ':00 ' + (n >= 12 ? 'PM' : 'AM'); };
    return hora(a) + ' A ' + hora(b);
  });
}
function D_NOMBRE_PDF(tipo, x) { return tipo + '-' + D_CLAVE(x.nombre) + '-' + x.doc + '.pdf'; }
function D_PREPARAR_IMPRESION(s, tipo) {
  if (tipo === 'FICHA') {
    [[15, 7], [25, 3], [33, 3]].forEach(function (r) { s.setRowHeights(r[0], r[1], 30); });
    ['B15:H21', 'B25:H27', 'B33:H35'].forEach(function (r) { s.getRange(r).setFontSize(16).setVerticalAlignment('middle'); });
    ['B15:D21', 'B25:D27', 'B33:D35'].forEach(function (r) { s.getRange(r).setFontSize(14); });
    s.getRange('F15:H27').setHorizontalAlignment('left').setWrap(true); s.setRowHeight(25, 54);
  } else if (tipo === 'CRONOGRAMA') {
    s.setRowHeights(11, 7, 34); s.setRowHeight(13, 54); s.setRowHeights(20, 7, 60); s.setRowHeights(31, 14, 44);
    s.getRange('B11:G17').setFontSize(20).setVerticalAlignment('middle');
    s.getRange('E11:G17').setHorizontalAlignment('left').setWrap(true);
    s.getRange('B20:G26').setFontSize(20).setVerticalAlignment('middle').setWrap(true);
    s.getRange('F21:F26').setHorizontalAlignment('left');
    s.getRange('F31').setFontSize(18).setWrap(true).setVerticalAlignment('middle');
    s.getRange('B28').setFontSize(16); s.setRowHeight(28, 30); s.setRowHeight(53, 34);
  } else if (tipo === 'BOLETA') {
    s.getRange('E10:Q11').setFontSize(18); s.setRowHeights(10, 2, 30);
    s.getRange('B15:Q15').setFontSize(18); s.setRowHeight(15, 32);
    s.getRange('B18:Q18').setFontSize(18).setVerticalAlignment('top');
    s.getRange('E18').setWrap(true);
    s.getRange('M56:Q62').setFontSize(17); s.setRowHeights(56, 7, 28);
  }
}
function D_URL_PDF(id, gid, rango) {
  return 'https://docs.google.com/spreadsheets/d/' + id + '/export?format=pdf&size=A4&portrait=true&scale=4&fzr=false&top_margin=0.4&bottom_margin=0.4&left_margin=0.4&right_margin=0.4&gridlines=false&printtitle=false&sheetnames=false&pagenum=UNDEFINED&gid=' + gid + '&range=' + encodeURIComponent(rango);
}
function D_PDF(tipo, x, destino, serie) {
  const nombre = D_NOMBRE_PDF(tipo, x), marca = 'MATRICULA_DOC:' + x.numero, existentes = destino.getFilesByName(nombre);
  if (existentes.hasNext()) { const f = existentes.next(); if (existentes.hasNext()) throw new Error('PDF DUPLICADO'); if (f.getDescription() !== marca) throw new Error('PDF DE OTRA MATRICULA: REVISAR ANTES DE REUTILIZAR'); return f; }
  const cfg = { BOLETA: [DOC.boleta, 'ÁREA ACADÉMICA', 'B2:Q62'], CRONOGRAMA: [DOC.cronograma, '6 MESES -CRONOGRAMA DE PAGO', 'B2:G60'], FICHA: [DOC.ficha, 'FICHA DE MATRÍCULA', 'B2:H46'] }[tipo];
  const props = PropertiesService.getScriptProperties(), key = 'TRABAJO PDF:' + x.numero + ':' + tipo;
  let id = props.getProperty(key);
  const soporte = D_CARPETA(D_CARPETA(DriveApp.getFolderById(DOC.raiz), 'SOPORTE AUTOMATIZACION'), 'COPIAS DE TRABAJO');
  if (!id) { const copy = DriveApp.getFileById(cfg[0]).makeCopy('TRABAJO-' + tipo + '-' + x.numero, soporte); id = copy.getId(); props.setProperty(key, id); }
  const ss = SpreadsheetApp.openById(id), s = ss.getSheetByName(cfg[1]); if (!s) throw new Error('PESTANA DE PLANTILLA AUSENTE');
  // Solo la copia de trabajo se rellena libremente; las listas del original se conservan.
  s.getDataRange().clearDataValidations();
  if (tipo === 'CRONOGRAMA') s.setRowHeight(53, 34);
  ss.setSpreadsheetTimeZone(DOC.tz); D_LLENAR(s, tipo, x, serie); D_PREPARAR_IMPRESION(s, tipo); SpreadsheetApp.flush();
  const url = D_URL_PDF(id, s.getSheetId(), cfg[2]);
  const response = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  if (response.getResponseCode() !== 200 || response.getContentText().slice(0, 4) !== '%PDF') throw new Error('ERROR AL EXPORTAR PDF: ' + response.getResponseCode());
  const pdf = destino.createFile(response.getBlob().setName(nombre)).setDescription(marca);
  // Se conserva temporalmente hasta que los tres PDF esten guardados.
  return pdf;
}
function D_LIMPIAR_COPIAS(numero) {
  const props = PropertiesService.getScriptProperties();
  ['BOLETA', 'CRONOGRAMA', 'FICHA'].forEach(function (tipo) {
    const key = 'TRABAJO PDF:' + numero + ':' + tipo, id = props.getProperty(key);
    if (!id) return;
    const originales = [DOC.boleta, DOC.cronograma, DOC.ficha, DOC.libro, DOC.admin];
    if (originales.indexOf(id) !== -1) throw new Error('NO SE PUEDE ELIMINAR UNA PLANTILLA ORIGINAL');
    DriveApp.getFileById(id).setTrashed(true);
    props.deleteProperty(key);
  });
}
function D_GENERAR(x, simulacion) {
  const props = PropertiesService.getScriptProperties(), key = 'SERIE DOC:' + x.numero;
  let serie = props.getProperty(key); if (!serie) { serie = simulacion ? 'SIMULACION - SIN VALIDEZ' : 'N° B002 - ' + D_NUMERO(); props.setProperty(key, serie); }
  const pago = D_CARPETA(D_CARPETA(DriveApp.getFolderById(x.estudianteId), D_CLAVE(x.curso)), 'PRIMER PAGO');
  const pdfs = ['BOLETA', 'CRONOGRAMA', 'FICHA'].map(function (t) { return D_PDF(t, x, pago, serie).getUrl(); });
  D_LIMPIAR_COPIAS(x.numero);
  return { serie: serie, pdfs: pdfs, carpeta: pago.getUrl() };
}
function GENERAR_DOCUMENTOS_PENDIENTES() {
  D_BLOQUEO(function () {
    const ss = D_LIBRO(), salida = ss.getSheetByName('DOCUMENTOS GENERADOS'); if (!salida) throw new Error('INSTALAR DOCUMENTOS PRIMERO');
    D_FILAS(ss.getSheetByName('PAGOS DE MATRICULA')).filter(function (r) { return r[0] !== ''; }).forEach(function (p) {
      const registros = D_FILAS(salida), encontrados = registros.map(function (r, i) { return D_TEXTO(r[0]) === D_TEXTO(p[0]) ? i + 2 : 0; }).filter(Boolean);
      if (encontrados.length > 1) throw new Error('SALIDA DUPLICADA');
      const fila = encontrados[0] || salida.getLastRow() + 1; if (encontrados[0] && D_CLAVE(salida.getRange(fila, 16).getValue()) === 'GENERADO') return;
      try {
        const x = D_DATOS(p[0]), result = D_GENERAR(x, false);
        salida.getRange(fila, 1, 1, 17).setValues([[x.numero, x.promo.id].concat(x.promo.precios, [x.pago, x.monto, x.emision, result.serie], result.pdfs, ['GENERADO', ''])]);
      } catch (e) { salida.getRange(fila, 1).setValue(p[0]); salida.getRange(fila, 16, 1, 2).setValues([['PENDIENTE', e.message]]); }
    });
    SpreadsheetApp.flush(); console.log('REVISION DE DOCUMENTOS TERMINADA');
  });
}
function SIMULAR_DOCUMENTOS_MATRICULA() {
  return D_BLOQUEO(function () {
    const root = D_CARPETA(DriveApp.getFolderById(DOC.raiz), 'SIMULACION DOCUMENTOS REVISION 004');
    const estudiante = D_CARPETA(D_CARPETA(D_CARPETA(root, '10-2026'), '8-10'), 'ESTUDIANTE DE PRUEBA-00000000');
    const x = { numero: 'SIMULACION-004', nombre: 'ESTUDIANTE DE PRUEBA', doc: '00000000', tipo: 'DNI', curso: 'NUTRICION Y DIETETICA M-J 20-22', inicio: '2026-10-12', pago: '2026-10-08', monto: 19.9, metodo: 'YAPE', promo: { id: 'PROMO 001', precios: [19.9, 79.9, 79.9, 79.9, 79.9, 79.9] }, emision: D_DIA(new Date()), nacimiento: '2000-01-01', direccion: 'DIRECCION DE PRUEBA', departamento: 'LIMA', celulares: '000000000 / 000000001', correo: 'prueba@example.com', estudianteId: estudiante.getId() };
    const result = D_GENERAR(x, true); console.log(JSON.stringify(result)); return result;
  });
}

/** Copia nativa conservando formatos; comprueba valores antes de retirar el origen por el conector. */
function COPIAR_PESTANAS_A_MATRIZ() {
  return D_BLOQUEO(function() {
    const origen = SpreadsheetApp.openById(DOC.libro), destino = D_LIBRO();
    destino.setSpreadsheetTimeZone(DOC.tz);
    const nombres = ['CONFIGURACION', 'ASESORAS Y HORARIOS', 'VALIDACIONES', 'PENDIENTES WHATSAPP', 'PROMOCIONES', 'PAGOS DE MATRICULA', 'DOCUMENTOS GENERADOS'];
    nombres.forEach(function(nombre) {
      const s = origen.getSheetByName(nombre); if (!s) throw new Error('FALTA ORIGEN: ' + nombre);
      let d = destino.getSheetByName(nombre);
      if (!d) d = s.copyTo(destino).setName(nombre);
      if (JSON.stringify(s.getDataRange().getValues()) !== JSON.stringify(d.getDataRange().getValues())) throw new Error('DATOS DIFERENTES: ' + nombre);
      console.log('COPIA VERIFICADA: ' + nombre + ' / ' + d.getSheetId());
    });
    console.log('SIETE PESTANAS COPIADAS Y VERIFICADAS');
  });
}
