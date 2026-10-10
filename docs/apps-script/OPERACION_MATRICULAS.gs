/** Complemento del proyecto MATRICULAS. No aprueba pagos ni envia mensajes. */
const O_CURSOS = [
  ['NUTRICION Y DIETETICA', 'WA NUTRICION Y DIETETICA M-J 20-22', [2,4]],
  ['AUXILIAR DE FARMACIA', 'WA AUXILIAR DE FARMACIA M-V 18-20', [3,5]],
  ['RECURSOS HUMANOS', 'WA RECURSOS HUMANOS L-M 20-22', [1,3]],
  ['ASISTENTE ADMINISTRATIVO', 'WA ASISTENTE ADMINISTRATIVO M-V 20-22', [3,5]],
  ['EDUCACION INICIAL', 'WA EDUCACION INICIAL L-M 18-20', [1,3]]
];
function O_CURSO_(valor) {
  const x=CLAVE_(valor), matches=O_CURSOS.filter(function(c){return x.indexOf(c[0])!==-1;});
  return matches.length===1?matches[0]:null;
}
function O_ISO_(value) {
  if(value instanceof Date)return DIA_(value);
  const x=String(value||'');
  return /^\d{4}-\d{2}-\d{2}$/.test(x)&&!isNaN(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x?x:'';
}
function O_SUMAR_(iso,dias) { return new Date(Date.parse(iso+'T12:00:00Z')+dias*86400000).toISOString().slice(0,10); }
/** Al cumplir cuatro dias se retira la cohorte anterior de la vista, no de MATRICULAS. */
function O_INICIO_VISIBLE_(filas,curso,hoy) {
  const fechas=filas.filter(function(r){const c=O_CURSO_(r[1]);return c&&c[0]===curso&&CLAVE_(r[4])==='SI';}).map(function(r){return O_ISO_(r[3]);}).filter(Boolean).sort();
  if(new Set(fechas).size!==fechas.length)throw new Error('INICIOS DUPLICADOS EN '+curso);
  return fechas.find(function(d){return hoy<O_SUMAR_(d,4);})||'';
}
function O_LISTA_(pendientes,curso,inicio) {
  if(!inicio)return [];
  return pendientes.filter(function(r){const c=O_CURSO_(r[1]);return c&&c[0]===curso&&O_ISO_(r[3])===inicio;}).map(function(r){return [r[0],curso,new Date(inicio+'T12:00:00-05:00'),String(r[6]||'')];}).sort(function(a,b){return Number(a[0])-Number(b[0]);});
}
function O_ACTUALIZAR_WHATSAPP_(hoy) {
  const libro=LIBRO_(), pendientes=PENDIENTES_(HOJA_('MATRICULAS')), inicios=TABLA_('CUADRO DE INICIOS');
  O_CURSOS.forEach(function(c){
    const inicio=O_INICIO_VISIBLE_(inicios,c[0],DIA_(hoy)), lista=O_LISTA_(pendientes,c[0],inicio);
    const s=libro.getSheetByName(c[1]);if(!s)throw new Error('FALTA LISTA '+c[1]);
    // Save the previous formula once, before replacing only this generated view.
    const props=PropertiesService.getScriptProperties(), backup='WA RESPALDO:'+s.getSheetId();
    if(!props.getProperty(backup))props.setProperty(backup,JSON.stringify(s.getRange(1,1,Math.min(4,s.getLastRow()),4).getFormulas()));
    if(s.getMaxRows()<lista.length+3)s.insertRowsAfter(s.getMaxRows(),lista.length+3-s.getMaxRows());
    s.getRange(1,1,Math.max(s.getLastRow(),3),4).clearContent();
    s.getRange('A1:D1').breakApart().merge().setValue(inicio?'INICIO: '+inicio.slice(8)+'/'+inicio.slice(5,7)+'/'+inicio.slice(0,4):'SIN PROXIMO INICIO CONFIGURADO').setFontColor('#d50000').setFontSize(24).setFontWeight('bold').setHorizontalAlignment('center').setBackground('#ffffff');
    s.getRange(2,1,1,4).setValues([['NUMERO','CURSO','FECHA DE INICIO','CELULAR']]).setFontWeight('bold').setBackground('#dce6f1').setFontColor('#000000');
    if(lista.length){s.getRange(3,4,lista.length,1).setNumberFormat('@');s.getRange(3,1,lista.length,4).setValues(lista);s.getRange(3,3,lista.length,1).setNumberFormat('dd/MM/yyyy');}
    s.setFrozenRows(2);s.setRowHeight(1,42);s.setColumnWidth(1,80);s.setColumnWidth(2,300);s.setColumnWidth(3,160);s.setColumnWidth(4,160);
    s.getRange(1,1,Math.max(lista.length+2,3),4).setVerticalAlignment('middle').setWrap(true);
  });
}
function O_PERIODO_(hoy) {
  const iso=O_ISO_(hoy);if(!iso)throw new Error('FECHA INVALIDA');
  const mes=iso.slice(0,7), dia=Number(iso.slice(8)), siguiente=new Date(mes+'-01T12:00:00Z');
  if(dia<=5){siguiente.setUTCMonth(siguiente.getUTCMonth()-1);return [siguiente.toISOString().slice(0,7)+'-21',mes+'-05'];}
  if(dia<=20)return [mes+'-06',mes+'-20'];
  siguiente.setUTCMonth(siguiente.getUTCMonth()+1);return [mes+'-21',siguiente.toISOString().slice(0,7)+'-05'];
}
function O_CANCELACIONES_(curso,props) {
  const fechas=[];
  Object.keys(props).filter(function(k){return k.indexOf('CANCELACIONES:')===0;}).forEach(function(k){const c=O_CURSO_(k);if(c&&c[0]===curso){const valores=JSON.parse(props[k]);if(!Array.isArray(valores)||valores.some(function(x){return !O_ISO_(x);}))throw new Error('CANCELACIONES INVALIDAS');fechas.push.apply(fechas,valores);}});
  if(curso==='ASISTENTE ADMINISTRATIVO'||curso==='EDUCACION INICIAL')fechas.push('2026-10-07');
  return Array.from(new Set(fechas));
}
/** Programacion no demuestra asistencia. DICTADAS CONFIRMADAS se confirma manualmente. */
function O_CONTEO_(curso,desde,hasta,canceladas) {
  if(!O_ISO_(desde)||!O_ISO_(hasta)||desde>hasta)throw new Error('PERIODO INVALIDO');
  const c=O_CURSO_(curso);if(!c)throw new Error('CURSO INVALIDO');
  const total=[],feriados=[],cancel=[],previstas=[];
  for(let iso=desde;iso<=hasta;iso=O_SUMAR_(iso,1)){
    if(c[2].indexOf(new Date(iso+'T12:00:00Z').getUTCDay())===-1)continue;
    total.push(iso);
    if(FERIADO_PERU_(iso))feriados.push(iso);
    else if(canceladas.indexOf(iso)!==-1)cancel.push(iso);
    else previstas.push(iso);
  }
  return {programadas:total,feriados:feriados,canceladas:cancel,previstas:previstas};
}
function O_CONTROL_CLASES_(hoy) {
  const admin=SpreadsheetApp.openById(V2.admin), nombre='CONTROL DE CLASES';
  let s=admin.getSheetByName(nombre);
  const headers=['DESDE','HASTA','CURSO','PROGRAMADAS','FERIADOS','CANCELADAS','PREVISTAS','DICTADAS CONFIRMADAS','DETALLE DE CAMBIOS','OBSERVACION ADMINISTRATIVA','ESTADO DEL CORTE'];
  if(!s){s=admin.insertSheet(nombre);s.getRange(1,1,1,headers.length).setValues([headers]);}
  if(s.getRange(1,1,1,headers.length).getValues()[0].map(CLAVE_).join('|')!==headers.join('|'))throw new Error('REVISAR CABECERAS DE CONTROL DE CLASES');
  const periodo=O_PERIODO_(DIA_(hoy)), props=PropertiesService.getScriptProperties().getProperties();
  const rows=s.getLastRow()>1?s.getRange(2,1,s.getLastRow()-1,headers.length).getValues():[];
  O_CURSOS.forEach(function(c){
    const conteo=O_CONTEO_(c[0],periodo[0],periodo[1],O_CANCELACIONES_(c[0],props));
    const found=rows.map(function(r,i){return {r:r,fila:i+2};}).filter(function(x){return O_ISO_(x.r[0])===periodo[0]&&O_ISO_(x.r[1])===periodo[1]&&CLAVE_(x.r[2])===c[0];});
    if(found.length>1)throw new Error('CORTE DUPLICADO EN '+c[0]);
    const fila=found.length?found[0].fila:s.getLastRow()+1, previo=found.length?found[0].r:[];
    const confirmadas=previo[7]===undefined?'':previo[7], observacion=previo[9]||'';
    const cambios=(conteo.feriados.length?'FERIADOS: '+conteo.feriados.join(', ')+'. ':'')+(conteo.canceladas.length?'CANCELADAS: '+conteo.canceladas.join(', ')+'. ':'');
    const cerrado=hoy.getTime()>=new Date(periodo[1]+'T22:00:00-05:00').getTime();
    let estado=cerrado?'CORTE CERRADO - CONFIRMAR DICTADAS':'EN CURSO - INCLUYE CLASES FUTURAS';
    if(confirmadas!==''&&(!Number.isInteger(Number(confirmadas))||Number(confirmadas)<0||Number(confirmadas)>conteo.previstas.length))estado='REVISAR CONFIRMADAS';
    else if(cerrado&&confirmadas!=='')estado='DICTADAS CONFIRMADAS POR ADMINISTRACION';
    s.getRange(fila,1,1,headers.length).setValues([[periodo[0],periodo[1],c[0],conteo.programadas.length,conteo.feriados.length,conteo.canceladas.length,conteo.previstas.length,confirmadas,cambios||'SIN CANCELACIONES NI FERIADOS EN ESTE CORTE',observacion,estado]]);
    s.getRange(fila,9).setFontColor(cambios?'#d50000':'#000000');
  });
  // Close the previous cut even when the first run after 22:00 falls on the next day.
  if(s.getLastRow()>1){const all=s.getRange(2,1,s.getLastRow()-1,headers.length).getValues();all.forEach(function(r,i){const fin=O_ISO_(r[1]);if(fin&&hoy.getTime()>=new Date(fin+'T22:00:00-05:00').getTime()&&String(r[10]).indexOf('EN CURSO')===0)s.getRange(i+2,11).setValue(r[7]===''?'CORTE CERRADO - CONFIRMAR DICTADAS':'DICTADAS CONFIRMADAS POR ADMINISTRACION');});}
  s.setFrozenRows(1);s.getRange(1,1,1,headers.length).setFontWeight('bold').setBackground('#153e6f').setFontColor('#ffffff').setWrap(true);s.setRowHeight(1,48);
  s.setColumnWidths(1,2,115);s.setColumnWidth(3,280);s.setColumnWidths(4,4,140);s.setColumnWidth(8,190);s.setColumnWidths(9,3,340);
  if(s.getLastRow()>1)s.getRange(2,1,s.getLastRow()-1,headers.length).setWrap(true).setVerticalAlignment('middle');
  if(!s.getFilter())s.getRange(1,1,s.getMaxRows(),headers.length).createFilter();
}
function ACTUALIZAR_OPERACION_MATRICULAS() {
  ACTUALIZAR_MATRICULAS_V2();
  BLOQUEO_(function(){const hoy=new Date();O_ACTUALIZAR_WHATSAPP_(hoy);O_CONTROL_CLASES_(hoy);console.log('LISTAS WHATSAPP Y CONTROL DE CLASES ACTUALIZADOS. DICTADAS REQUIERE CONFIRMACION.');});
}
function INSTALAR_OPERACION_MATRICULAS() {
  ACTUALIZAR_OPERACION_MATRICULAS();
  if(!ScriptApp.getProjectTriggers().some(function(t){return t.getHandlerFunction()==='ACTUALIZAR_OPERACION_MATRICULAS';}))ScriptApp.newTrigger('ACTUALIZAR_OPERACION_MATRICULAS').timeBased().everyMinutes(5).create();
  console.log('OPERACION INSTALADA CADA CINCO MINUTOS. NO ENVIA MENSAJES.');
}
