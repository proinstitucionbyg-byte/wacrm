/** Complemento del puente existente. Directorio privado: nunca se publica a estudiantes. */
function D_DIRECTORIO_() {
  const s=SpreadsheetApp.openById(V2.admin).getSheetByName('DOCENTES');
  if(!s)throw new Error('FALTA DIRECTORIO DOCENTES');
  const rows=s.getDataRange().getDisplayValues(), h=rows.shift().map(CLAVE_);
  const expected=['CURSO','DOCENTE','SEXO','PAIS DEL NUMERO','CODIGO PAIS','TELEFONO LOCAL','WHATSAPP INTERNACIONAL','OTROS NUMEROS AUTORIZADOS','ACTIVO'];
  if(expected.some(function(v,i){return h[i]!==v;}))throw new Error('REVISAR CABECERAS DOCENTES');
  return rows.filter(function(r){return CLAVE_(r[8])==='SI';}).map(function(r){
    const raw=[r[6]].concat(String(r[7]||'').split(';').filter(function(x){return x.trim();}));
    if(raw.some(function(x){return !/^\+[1-9][\d\s()-]{7,20}$/.test(x.trim());}))throw new Error('DOCENTE SIN NUMERO INTERNACIONAL VALIDO');
    return {name:TEXTO_(r[1]),course:CLAVE_(r[0]),phones:raw.map(function(x){return x.replace(/\D/g,'');})};
  });
}
function D_CURSO_(value) {const x=CLAVE_(value);return x.indexOf('EDUCACION')!==-1?'AUXILIAR DE EDUCACION INICIAL':x.indexOf('NUTRICION')!==-1?'NUTRICION Y DIETETICA':x.indexOf('FARMACIA')!==-1?'AUXILIAR DE FARMACIA':x.indexOf('RECURSOS')!==-1?'RECURSOS HUMANOS':x.indexOf('ADMINISTRATIVO')!==-1?'ASISTENTE ADMINISTRATIVO':'';}
function D_APLICAR_(job) {
  if(!job||!job.id||!D_CURSO_(job.course)||!/^\d{4}-\d{2}-\d{2}$/.test(job.class_date))throw new Error('REPROGRAMACION INVALIDA');
  const props=PropertiesService.getScriptProperties(), marker='DOCENTE APLICADO:'+job.id;
  if(props.getProperty(marker))return;
  const s=HOJA_('CUADRO DE INICIOS'), filas=s.getRange(1,1,s.getLastRow(),9).getValues();
  LEER_CUADROS_INICIOS_(filas); // Validate the whole source before touching any date.
  let titulo='',found=null,modulos=[];
  filas.forEach(function(r,i){
    const t=CLAVE_(r[1]),n=Number(r[1]);
    if(/^(NUTRICION Y DIETETICA|AUXILIAR DE FARMACIA|RECURSOS HUMANOS|ASISTENTE ADMINISTRATIVO|AUXILIAR DE EDUCACION INICIAL)/.test(t)){titulo=t;modulos=[];}
    if(Number.isInteger(n)&&n>=1&&n<=6&&TEXTO_(r[2]))modulos.push({row:i+1,day:DIA_(r[8])});
    if(t==='ACTIVO'&&D_CURSO_(titulo)===D_CURSO_(job.course))found={title:titulo,modules:modulos.slice()};
  });
  if(!found)throw new Error('CURSO NO ACTIVO');
  const savedPlan=props.getProperty('DOCENTE PLAN:'+job.id),plan=savedPlan?JSON.parse(savedPlan):null;
  const current=plan?found.modules.filter(function(m){return m.row===plan.currentRow;})[0]:found.modules.filter(function(m){return m.day&&m.day<=job.class_date;}).sort(function(a,b){return b.day.localeCompare(a.day);})[0];
  if(!current)throw new Error('FALTA MODULO ACTUAL');
  const days=job.course.indexOf('NUTRICION')!==-1?[2,4]:(job.course.indexOf('FARMACIA')!==-1||job.course.indexOf('ADMINISTRATIVO')!==-1)?[3,5]:[1,3];
  const key='CANCELACIONES:'+found.title,cancelled=JSON.parse(props.getProperty(key)||'[]');
  if(!Array.isArray(cancelled))throw new Error('CANCELACIONES INVALIDAS');
  if((job.course.indexOf('ADMINISTRATIVO')!==-1||job.course.indexOf('EDUCACION')!==-1)&&cancelled.indexOf('2026-10-07')===-1)cancelled.push('2026-10-07');
  if(cancelled.indexOf(job.class_date)===-1)cancelled.push(job.class_date);
  let start=plan?plan.start:current.day;
  // If the first class is cancelled, move the official start to the next scheduled class.
  while(days.indexOf(new Date(start+'T12:00:00Z').getUTCDay())===-1||FERIADO_PERU_(start)||cancelled.indexOf(start)!==-1)start=new Date(Date.parse(start+'T12:00:00Z')+86400000).toISOString().slice(0,10);
  const next=found.modules[(found.modules.indexOf(current)+1)%found.modules.length],date=SIGUIENTE_INICIO_CICLICO_(start,days,cancelled);
  if(!savedPlan)props.setProperty('DOCENTE PLAN:'+job.id,JSON.stringify({currentRow:current.row,start:current.day}));
  // The stored cancellation makes retries idempotent even if writing the marker fails.
  props.setProperty(key,JSON.stringify(cancelled));
  s.getRange(current.row,9).setValue(new Date(start+'T12:00:00-05:00')).setNumberFormat('dd/MM/yyyy');
  s.getRange(next.row,9).setValue(new Date(date+'T12:00:00-05:00')).setNumberFormat('dd/MM/yyyy').setFontColor('#d50000').setNote('REPROGRAMADO: clase '+job.class_date+' suspendida. Nuevo inicio '+date+'. Avisar grupos, nuevos ingresos y coordinadora de fidelizacion.');
  props.setProperty('DOCENTE AVISO:'+next.row,JSON.stringify({expires:Date.now()+3*86400000,date:date}));
  RESALTAR_CUADROS_INICIOS_(new Date());SpreadsheetApp.flush();props.setProperty(marker,'SI');
}
function D_LIMPIAR_AVISOS_() {
  const p=PropertiesService.getScriptProperties(),all=p.getProperties(),s=HOJA_('CUADRO DE INICIOS');
  Object.keys(all).filter(function(k){return k.indexOf('DOCENTE AVISO:')===0;}).forEach(function(k){const notice=JSON.parse(all[k]);if(Date.now()<notice.expires)return;const cell=s.getRange(Number(k.split(':')[1]),9);if(DIA_(cell.getValue())===notice.date&&String(cell.getNote()).indexOf('REPROGRAMADO:')===0)cell.clearNote().setFontColor('#000000');p.deleteProperty(k);});
}
function SINCRONIZAR_DOCENTES_CRM() {
  return BLOQUEO_(function(){
    const response=C_API_('/teachers',{teachers:D_DIRECTORIO_()}),jobs=response.jobs||[];
    jobs.forEach(D_APLICAR_);
    if(jobs.length){
      O_ACTUALIZAR_WHATSAPP_(new Date());O_CONTROL_CLASES_(new Date());
      const result=C_SINCRONIZAR_CUADRO_(jobs.map(function(j){return j.id;}));
      if(result.deferred)throw new Error('OTRA REPROGRAMACION ENTRO DURANTE LA ACTUALIZACION: SE REINTENTARA');
    }
    D_LIMPIAR_AVISOS_();
  });
}
function INSTALAR_DOCENTES_CRM() {
  SINCRONIZAR_DOCENTES_CRM();
  if(!ScriptApp.getProjectTriggers().some(function(t){return t.getHandlerFunction()==='SINCRONIZAR_DOCENTES_CRM';}))ScriptApp.newTrigger('SINCRONIZAR_DOCENTES_CRM').timeBased().everyMinutes(1).create();
  console.log('DIRECTORIO PRIVADO Y REPROGRAMACIONES INSTALADOS. AVISOS TRES DIAS.');
}
