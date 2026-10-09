/** Instalar EN EL MISMO proyecto de MATRICULAS_V2 para compartir su bloqueo y numeracion manual.
 * Propiedades privadas: CRM_BASE_URL (https://...), CRM_SYNC_KEY (solo enrollments:sync).
 * No contiene claves. No aprueba pagos. Los documentos siguen en el proyecto de BOLETAS.
 */
function C_CONFIG_() {
  const p=PropertiesService.getScriptProperties(), base=p.getProperty('CRM_BASE_URL'), key=p.getProperty('CRM_SYNC_KEY');
  if(!/^https:\/\/[a-z0-9.-]+$/i.test(base||'')||!key)throw new Error('FALTA CONFIGURAR LA CONEXION PRIVADA AL CRM');
  return {base:base,key:key};
}
function C_API_(path, body) {
  const c=C_CONFIG_(), r=UrlFetchApp.fetch(c.base+'/api/v1/enrollments'+path,{method:'post',headers:{Authorization:'Bearer '+c.key},contentType:'application/json',payload:JSON.stringify(body||{}),muteHttpExceptions:true});
  const value=JSON.parse(r.getContentText());
  if(r.getResponseCode()!==200)throw new Error('CRM: '+(value.error&&value.error.message||r.getResponseCode()));
  return value.data;
}
function C_FOTO_(job, messageId, folder, tipo) {
  const c=C_CONFIG_(), nombre=tipo+'-'+messageId, existentes=folder.getFiles();
  while(existentes.hasNext()){const f=existentes.next();if(f.getName().indexOf(nombre+'.')===0)return f;}
  const r=UrlFetchApp.fetch(c.base+'/api/v1/enrollments/'+job.id+'/files/'+messageId,{headers:{Authorization:'Bearer '+c.key,'X-Enrollment-Lease':job.lease_token},muteHttpExceptions:true});
  if(r.getResponseCode()!==200)throw new Error('NO SE PUDO DESCARGAR LA FOTO ORIGINAL '+tipo);
  const blob=r.getBlob(), mime=blob.getContentType().split(';')[0], ext={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[mime];
  if(!ext)throw new Error('FORMATO DE FOTO NO ADMITIDO');
  return folder.createFile(blob.setName(nombre+'.'+ext));
}
function C_FILA_ADMIN_(sheet, numero, values) {
  const filas=sheet.getLastRow()>1?sheet.getRange(2,1,sheet.getLastRow()-1,1).getValues():[];
  const matches=[];filas.forEach(function(r,i){if(String(r[0])===String(numero))matches.push(i+2);});
  if(matches.length>1)throw new Error('REGISTRO ADMINISTRATIVO DUPLICADO');
  sheet.getRange(matches[0]||Math.max(2,sheet.getLastRow()+1),1,1,values.length).setValues([values]);
}
function C_REGISTRAR_(job) {
  const d=job.data, s=HOJA_('MATRICULAS'), admin=SpreadsheetApp.openById(V2.admin), m=MAPA_(s);
  const cursos=['NUTRICION Y DIETETICA M-J 20-22','AUXILIAR DE FARMACIA M-V 18-20','RECURSOS HUMANOS L-M 20-22','ASISTENTE ADMINISTRATIVO M-V 20-22','EDUCACION INICIAL L-M 18-20'];
  const nombres=['NUTRICION Y DIETETICA','AUXILIAR DE FARMACIA','RECURSOS HUMANOS','ASISTENTE ADMINISTRATIVO','AUXILIAR DE EDUCACION INICIAL'];
  const index=cursos.findIndex(function(c,i){return CLAVE_(d.course)===c||CLAVE_(d.course)===nombres[i];});
  if(index<0)throw new Error('REVISAR CURSO: NO COINCIDE CON EL CUADRO DE INICIOS');
  const curso=cursos[index], inicios=TABLA_('CUADRO DE INICIOS').filter(function(r){return CLAVE_(r[1])===curso&&DIA_(r[3])===d.start_date&&CLAVE_(r[4])==='SI';});
  if(inicios.length!==1)throw new Error('REVISAR FECHA OFICIAL: NO COINCIDE CON EL CUADRO DE INICIOS');
  if(!d.identity_confirmed||!d.offer_confirmed||!d.identity_message_ids.length||d.prices.length!==6||Number(d.amount)!==d.prices[0])throw new Error('FALTAN CONFIRMACIONES DE IDENTIDAD U OFERTA');
  const markerColumn=29, header=CLAVE_(s.getRange(1,markerColumn).getValue());
  if(header&&header!=='ID MATRICULA CRM')throw new Error('LA COLUMNA AC ESTA OCUPADA; REVISAR ANTES DE INSTALAR');
  s.getRange(1,markerColumn).setValue('ID MATRICULA CRM');s.hideColumns(markerColumn);
  const ids=s.getLastRow()>1?s.getRange(2,markerColumn,s.getLastRow()-1,1).getValues():[], matches=[];
  ids.forEach(function(r,i){if(CLAVE_(r[0])===CLAVE_(job.id))matches.push(i+2);});
  if(matches.length>1)throw new Error('ID CRM DUPLICADO');
  let fila=matches[0];
  if(!fila){
    fila=Math.max(2,s.getLastRow()+1);const row=Array(markerColumn).fill('');
    if(!job.sales_adviser||!String(job.sales_adviser).trim())throw new Error('FALTA CONFIRMAR ATRIBUCION DE VENTA EN CRM');
    const values={'NOMBRE COMPLETO':d.full_name,'TIPO DE DOCUMENTO':d.document_type,'NUMERO DE DOCUMENTO':d.document_number,'F. NACIMIENTO':d.birth_date?new Date(d.birth_date+'T12:00:00-05:00'):'','CELULAR 1':d.phone1,'CELULAR 2':d.phone2||'','DIRECCION':d.address||'','DEPARTAMENTO':d.department||'','DISTRITO':d.district||'','CORREO ELECTRONICO':d.email,'CURSO':curso,'FECHA DE INICIO':new Date(d.start_date+'T12:00:00-05:00'),'PROMO':d.promotion_id,'ID DE INICIO':inicios[0][0]};
    values['ASESORA DE VTAS.']=String(job.sales_adviser).trim().toUpperCase();
    Object.keys(values).forEach(function(k){if(!m[k])throw new Error('FALTA COLUMNA '+k);row[m[k]-1]=values[k];});
    row[markerColumn-1]=CLAVE_(job.id);
    ['NUMERO DE DOCUMENTO','CELULAR 1','CELULAR 2'].forEach(function(k){s.getRange(fila,m[k]).setNumberFormat('@');});
    s.getRange(fila,1,1,row.length).setValues([row]);SpreadsheetApp.flush();
  }
  PROCESAR_FILAS_V2_(s,fila,1,1,markerColumn-1,new Date());SpreadsheetApp.flush();
  const numero=s.getRange(fila,m['N°']).getValue(), nombre=s.getRange(fila,m['NOMBRE COMPLETO']).getValue(), doc=s.getRange(fila,m['NUMERO DE DOCUMENTO']).getValue();
  if(!numero||CLAVE_(nombre)!==CLAVE_(d.full_name)||String(doc)!==d.document_number)throw new Error('IDENTIDAD O NUMERACION NO COINCIDEN EN REINTENTO');
  const rootId=ID_DRIVE_(OPCIONES_()['CARPETA GENERAL ID']);if(!rootId)throw new Error('FALTA CARPETA GENERAL');
  const root=DriveApp.getFolderById(rootId), props=PropertiesService.getScriptProperties(), key='ALUMNO:'+rootId+':'+CLAVE_(d.document_type)+':'+d.document_number;
  const ruta=RUTA_ESTUDIANTE_(s.getRange(fila,m['FECHA DE HOY']).getValue(),nombre,doc,curso);
  let estudiante=props.getProperty(key)?DriveApp.getFolderById(props.getProperty(key)):null;
  if(estudiante)VERIFICAR_IDENTIDAD_CARPETA_(estudiante.getName(),nombre,doc);
  else{estudiante=CARPETA_UNICA_(CARPETA_UNICA_(CARPETA_UNICA_(root,ruta[0]),ruta[1]),ruta[2]);props.setProperty(key,estudiante.getId());}
  const primerPago=CARPETA_UNICA_(CARPETA_UNICA_(estudiante,ruta[3]),'PRIMER PAGO');
  if(!job.voucher_message_id)throw new Error('FALTA FOTO DEL VOUCHER');
  const voucher=C_FOTO_(job,job.voucher_message_id,primerPago,'VOUCHER');
  const documentos=d.identity_message_ids.map(function(id){return C_FOTO_(job,id,primerPago,'DOCUMENTO');});
  s.getRange(fila,m['LINK DE CARPETA DEL ESTUDIANTE']).setValue(estudiante.getUrl());
  const validaciones=admin.getSheetByName('VALIDACIONES'), pagos=admin.getSheetByName('PAGOS DE MATRICULA');
  if(!validaciones||!pagos)throw new Error('FALTAN TABLAS ADMINISTRATIVAS');
  const snapshot={id:CLAVE_(d.promotion_id),precios:d.prices,confirmadaEnCRM:job.id};
  const cabecera=CLAVE_(pagos.getRange(1,7).getValue());if(cabecera&&cabecera!=='OFERTA CONFIRMADA JSON')throw new Error('COLUMNA G DE PAGOS OCUPADA');
  pagos.getRange(1,7).setValue('OFERTA CONFIRMADA JSON');
  C_FILA_ADMIN_(validaciones,numero,[numero,'VALIDADO','VALIDACION HUMANA CRM '+job.review_id,documentos[0].getId(),voucher.getId(),'','','']);
  C_FILA_ADMIN_(pagos,numero,[numero,CLAVE_(d.promotion_id),new Date(d.payment_date+'T12:00:00-05:00'),Number(d.amount),CLAVE_(d.payment_method),job.id,JSON.stringify(snapshot)]);
  SpreadsheetApp.flush();return {registered_number:String(numero),student_folder_url:estudiante.getUrl()};
}
function SINCRONIZAR_CRM_MATRICULAS() {
  return BLOQUEO_(function(){
    C_ENVIAR_DOCUMENTOS_PENDIENTES_();
    const job=C_API_('/claim',{}).job;if(!job)return;
    let result;
    try{result=C_REGISTRAR_(job);}catch(error){C_API_('/'+job.id+'/result',{lease_token:job.lease_token,status:'error',error:String(error.message||'ERROR DE REGISTRO').slice(0,1000)});throw error;}
    // Do not report a network timeout as failed registration: the lease will retry using the same row ID.
    const callback=Object.assign({lease_token:job.lease_token,status:'registered'},result);
    PropertiesService.getScriptProperties().setProperty('CRM DOCUMENTOS:'+job.id,JSON.stringify(callback));
    C_API_('/'+job.id+'/result',callback);
  });
}
/** Uses the PDFs already generated by the Boletas project; never copies Excel into PRIMER PAGO. */
function C_ENVIAR_DOCUMENTOS_PENDIENTES_() {
  const props=PropertiesService.getScriptProperties(), values=props.getProperties(), c=C_CONFIG_();
  const admin=SpreadsheetApp.openById(V2.admin), s=admin.getSheetByName('DOCUMENTOS GENERADOS');
  if(!s)return;
  const rows=s.getLastRow()>1?s.getRange(2,1,s.getLastRow()-1,17).getValues():[];
  Object.keys(values).filter(function(k){return k.indexOf('CRM DOCUMENTOS:')===0;}).slice(0,3).forEach(function(key){
    const id=key.slice('CRM DOCUMENTOS:'.length), task=JSON.parse(values[key]);
    try {
      // Recover a lost registration callback using its existing lease, without creating another row.
      C_API_('/'+id+'/result',task);
      const matches=rows.filter(function(r){return String(r[0])===String(task.registered_number);});
      if(matches.length!==1||CLAVE_(matches[0][15])!=='GENERADO')return;
      ['BOLETA','CRONOGRAMA','FICHA'].forEach(function(kind,i){
        if((task.sent||[]).indexOf(kind)!==-1)return;
        const match=/\/d\/([\w-]+)/.exec(String(matches[0][12+i]));
        if(!match)throw new Error('FALTA PDF '+kind);
        const file=DriveApp.getFileById(match[1]);
        if(file.getMimeType()!=='application/pdf')throw new Error('DOCUMENTO NO ES PDF');
        const response=UrlFetchApp.fetch(c.base+'/api/v1/enrollments/'+id+'/documents/'+kind,{method:'post',headers:{Authorization:'Bearer '+c.key,'X-Enrollment-Lease':task.lease_token},contentType:'application/pdf',payload:file.getBlob().getBytes(),muteHttpExceptions:true});
        if(response.getResponseCode()!==200)throw new Error('ENVIO '+kind+': REVISAR EN CRM ('+response.getResponseCode()+')');
        task.sent=(task.sent||[]).concat(kind);props.setProperty(key,JSON.stringify(task));
      });
      if(task.sent.length===3)props.deleteProperty(key);
    } catch(error){ console.warn('DOCUMENTOS CRM '+id+': '+String(error.message||'REVISAR ENVIO')); }
  });
}
function INSTALAR_PUENTE_CRM_MATRICULAS() {
  C_CONFIG_();
  if(!ScriptApp.getProjectTriggers().some(function(t){return t.getHandlerFunction()==='SINCRONIZAR_CRM_MATRICULAS';}))ScriptApp.newTrigger('SINCRONIZAR_CRM_MATRICULAS').timeBased().everyMinutes(5).create();
  console.log('PUENTE INSTALADO. SOLO MATRICULAS EN COLA CON PAGO VALIDADO. DOCUMENTOS Y ENVIO TIENEN ESTADOS SEPARADOS.');
}
