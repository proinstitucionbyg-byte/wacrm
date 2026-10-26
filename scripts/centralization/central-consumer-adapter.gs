/** Complements the installed enrollment bridge. Append-only consultation copy.
 * Reuses C_CONFIG_(), the existing enrollments:sync key and the verified planner.
 * Never approves payments, generates files, sends messages or overwrites existing rows.
 */
var VC_BOOKS_ = ['1qg1xwDf0RIscrXFaupj-EuUzWEzfNNSrfHhglAIXbo8', '1b1ZlP9PWKu0I9VaJIE9bYDJsy5Ooy6OYtCupfBa-0eo'];
var VC_COLUMNS_ = { ALUMNOS:18, MATRICULAS:20, PAGOS:15, DOCUMENTOS:14 };
function VC_TEXT_(v) { return String(v == null ? '' : v).trim(); }
function VC_DATE_(v) {
  if (!v) return '';
  return Utilities.formatDate(new Date(v), 'America/Lima', 'yyyy-MM-dd');
}
function VC_VALUES_(range) {
  return range.getValues().map(function(row){return row.map(function(v){
    if(!(v instanceof Date))return v;
    var day=Utilities.formatDate(v,'America/Lima','yyyy-MM-dd');
    return Date.parse(day+'T00:00:00Z')/86400000+25569;
  });});
}
function VC_SOURCE_(jobs, matriculas, documents) {
  var ready=[], pending=0, numbers={};
  documents.slice(1).forEach(function(row){var n=VC_TEXT_(row[0]);if(!n)return;if(numbers[n])throw Error('DOCUMENTOS: NUMERO DUPLICADO');numbers[n]=row;});
  jobs.forEach(function(job){
    if(job.status!=='registered'){pending++;return;}
    var docs=numbers[VC_TEXT_(job.registered_number)];
    if(!docs||docs[15]!=='GENERADO'){pending++;return;}
    if(!job.contact_id||!job.reviewed_by||!job.reviewed_at)throw Error('PUENTE SIN IDENTIDAD ESTABLE O REVISION HUMANA');
    var copy=JSON.parse(JSON.stringify(job));
    copy.account_id='4d761b3c-4c6c-4986-bcd8-d95f1754fe35';
    copy.data.prices=docs.slice(2,8).map(Number);
    var tipo=VC_TEXT_(copy.data.document_type).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
    if(tipo==='CARNE DE EXTRANJERIA'||tipo==='CARNET DE EXTRANJERIA')copy.data.document_type='CE';
    copy.updated_at=VC_DATE_(copy.updated_at);copy.reviewed_at=VC_DATE_(copy.reviewed_at);
    // The API does not assert original contact arrival/referral or delivery receipts.
    // Leave those unknown; never infer them from document creation or an absent API row.
    copy.contact_created_at='';copy.first_ad_referral=null;copy.deliveries=[];
    ready.push(copy);
  });
  return {source:{enrollments:ready,matriculas:{values:matriculas},documents:{values:documents}},pending:pending};
}
/** Preflight all IDs and identities before any writes. Existing values are untouched. */
function VC_APPEND_PLAN_(existing,incoming) {
  var seen={}, identities={};
  Object.keys(VC_COLUMNS_).forEach(function(table){
    seen[table]={};
    (existing[table]||[]).forEach(function(row){
      var id=VC_TEXT_(row[0]);
      if(!id){if(row.some(function(v){return v!==''&&v!=null;}))throw Error('FILA CON DATOS SIN ID: '+table);return;}
      if(seen[table][id])throw Error('ID DESTINO DUPLICADO: '+table);seen[table][id]=row;
      if(table==='ALUMNOS'&&row[3]&&row[4]){
        var key=VC_TEXT_(row[3]).toUpperCase()+':'+VC_TEXT_(row[4]).toUpperCase();
        if(identities[key]&&identities[key]!==id)throw Error('IDENTIDAD DESTINO DUPLICADA');identities[key]=id;
      }
    });
  });
  var additions={};
  Object.keys(VC_COLUMNS_).forEach(function(table){
    additions[table]=[];var batch={};
    (incoming[table]||[]).forEach(function(row){
      var id=VC_TEXT_(row[0]);if(!id||row.length!==VC_COLUMNS_[table]||batch[id])throw Error('LOTE INVALIDO: '+table);batch[id]=true;
      if(table==='ALUMNOS'){
        var identity=VC_TEXT_(row[3]).toUpperCase()+':'+VC_TEXT_(row[4]).toUpperCase();
        if(identities[identity]&&identities[identity]!==id)throw Error('MISMO DOCUMENTO CON OTRO ID: CONCILIAR');
        identities[identity]=id;
      }
      var old=seen[table][id];
      if(old){
        // IDs are immutable relations, not mutable names/statuses.
        var links=table==='ALUMNOS'?[1]:table==='MATRICULAS'?[1]:table==='PAGOS'?[1,2]:[1,2,3];
        if(links.some(function(i){return VC_TEXT_(old[i])!==VC_TEXT_(row[i]);}))throw Error('RELACION EXISTENTE DIFERENTE: '+table);
        return;
      }
      additions[table].push(row.slice());seen[table][id]=row;
    });
  });
  return additions;
}
function VC_JOBS_() {
  var config=C_CONFIG_(), cursor='', jobs=[], seen={};
  if(config.base!=='https://personal-wacrm.exjald.easypanel.host')throw Error('HOST CRM NO ESPERADO');
  for(var page=0;page<20;page++){
    var response=UrlFetchApp.fetch(config.base+'/api/v1/enrollments/sheet?limit=50'+(cursor?'&cursor='+encodeURIComponent(cursor):''),{headers:{Authorization:'Bearer '+config.key},muteHttpExceptions:true});
    if(response.getResponseCode()!==200)throw Error('NO SE PUDO LEER EL PUENTE CRM: '+response.getResponseCode());
    var result=JSON.parse(response.getContentText());
    if(!Array.isArray(result.data)||!result.meta)throw Error('RESPUESTA CRM INVALIDA');
    result.data.forEach(function(job){if(!job.id||seen[job.id])throw Error('ID REPETIDO EN PAGINACION CRM');seen[job.id]=true;jobs.push(job);});
    var next=result.meta.next_cursor||'';if(!next)return jobs;
    if(next===cursor)throw Error('CURSOR CRM REPETIDO');cursor=next;
  }
  throw Error('PAGINACION INCOMPLETA: NO SE ESCRIBIO NADA');
}
function VC_ROWS_(sheet,width,start) {
  if(!sheet)throw Error('FALTA PESTANA EXISTENTE');
  if(sheet.getLastRow()>10000)throw Error('LOTE FUERA DEL LIMITE: REVISAR');
  return sheet.getLastRow()<start?[]:VC_VALUES_(sheet.getRange(start,1,sheet.getLastRow()-start+1,width));
}
function VC_RUN_(write) {
  var lock=LockService.getScriptLock();lock.waitLock(20000);
  try{
    var original=SpreadsheetApp.openById('16jhqgiYLh_GCkuxPL2fpljf04-Pj2HAqNY_0ePT0z7w').getSheetByName('MATRICULAS');
    var admin=SpreadsheetApp.openById('12qF1Y0X4PjY6YtnWJG7NyQ15cWmXK9fW-7gMWKJxLQc').getSheetByName('DOCUMENTOS GENERADOS');
    // Display values preserve document/phone zeros and local source dates.
    var source=VC_SOURCE_(VC_JOBS_(),original.getRange(1,1,original.getLastRow(),23).getDisplayValues(),admin.getRange(1,1,admin.getLastRow(),17).getDisplayValues());
    var planned=VORTEX_PLAN_CORE_.planEnrollments(source.source), books=[];
    VC_BOOKS_.forEach(function(id){
      var book=SpreadsheetApp.openById(id),existing={},sheets={};
      Object.keys(VC_COLUMNS_).forEach(function(name){
        var sheet=book.getSheetByName(name),width=VC_COLUMNS_[name];if(!sheet)throw Error('FALTA PESTANA: '+name);
        var headers=sheet.getRange(4,1,1,width).getValues()[0];
        var first={ALUMNOS:'Estudiante_ID',MATRICULAS:'Matricula_ID',PAGOS:'Pago_ID',DOCUMENTOS:'Documento_ID'}[name];
        if(headers[0]!==first||headers.some(function(v){return !v;}))throw Error('CABECERAS CAMBIARON: '+name);
        existing[name]=VC_ROWS_(sheet,width,5);sheets[name]=sheet;
      });
      books.push({id:id,existing:existing,sheets:sheets,additions:VC_APPEND_PLAN_(existing,planned.tables)});
    });
    var counts=[];
    books.forEach(function(book){
      var added={};
      Object.keys(VC_COLUMNS_).forEach(function(name){
        var rows=book.additions[name],sheet=book.sheets[name],width=VC_COLUMNS_[name];added[name]=rows.length;
        if(!write||!rows.length)return;
        var current=VC_ROWS_(sheet,width,5);
        if(JSON.stringify(current)!==JSON.stringify(book.existing[name]))throw Error('CAMBIO HUMANO DURANTE LA LECTURA: '+name);
        // Skip no occupied rows; append after the last actual ID, not formatted empty cells.
        var last=4;current.forEach(function(row,i){if(row.some(function(v){return v!==''&&v!=null;}))last=i+5;});
        var range=sheet.getRange(last+1,1,rows.length,width);
        var actual=range.getValues(),formulas=range.getFormulas();
        if(actual.some(function(r){return r.some(function(v){return v!==''&&v!=null;});})||formulas.some(function(r){return r.some(Boolean);}))throw Error('DESTINO OCUPADO: '+name);
        // Treat all text as literal, never as a formula supplied through customer data.
        var literal=rows.map(function(r){return r.map(function(v){return typeof v==='string'&&/^[=+@]/.test(v)?"'"+v:v;});});
        range.setValues(literal);SpreadsheetApp.flush();
        if(JSON.stringify(VC_VALUES_(range))!==JSON.stringify(rows))throw Error('LECTURA DE VUELTA NO COINCIDE: '+name);
      });
      counts.push(added);
    });
    var summary={mode:write?'append-only':'read-only',registered:source.source.enrollments.length,pending:source.pending,additions:counts,at:new Date().toISOString()};
    console.log(JSON.stringify(summary));return summary;
  }finally{lock.releaseLock();}
}
function VERIFICAR_PUENTE_CENTRAL_CONSULTA(){return VC_RUN_(false);}
function SINCRONIZAR_CENTRAL_CONSULTA(){return VC_RUN_(true);}
function INSTALAR_PUENTE_CENTRAL_CONSULTA(){
  // Preflight without changing tables before installing the periodic consumer.
  VERIFICAR_PUENTE_CENTRAL_CONSULTA();
  if(!ScriptApp.getProjectTriggers().some(function(t){return t.getHandlerFunction()==='SINCRONIZAR_CENTRAL_CONSULTA';}))ScriptApp.newTrigger('SINCRONIZAR_CENTRAL_CONSULTA').timeBased().everyMinutes(10).create();
  console.log('PUENTE DE CONSULTA INSTALADO CADA 10 MINUTOS. EXISTENTES CONSERVADOS. SIN ENVIOS NI EDICION BILATERAL.');
}
