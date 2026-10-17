/** Fechas editables; formato fijo y motivo obligatorio antes de publicar un cambio. */
function F_FECHA_(v) {
  if (v instanceof Date) return DIA_(v);
  const t=String(v==null?'':v).trim();if(!t)return '';
  const m=/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/.exec(t);
  const iso=m?m[3]+'-'+m[2].padStart(2,'0')+'-'+m[1].padStart(2,'0'):t;
  return /^\d{4}-\d{2}-\d{2}$/.test(iso)&&!isNaN(Date.parse(iso))&&new Date(iso).toISOString().slice(0,10)===iso?iso:null;
}
function F_BLOQUES_(s) {
  const rows=s.getRange(1,1,s.getLastRow(),9).getValues(), result=[];let titulo='';
  rows.forEach(function(r,i){const t=CLAVE_(r[1]),n=Number(r[1]);
    if(/^(NUTRICION Y DIETETICA|AUXILIAR DE FARMACIA|RECURSOS HUMANOS|ASISTENTE ADMINISTRATIVO|AUXILIAR DE EDUCACION INICIAL)/.test(t))titulo=t;
    if(Number.isInteger(n)&&n>=1&&n<=6&&TEXTO_(r[2]))result.push({row:i+1,numero:n,titulo:titulo,nombre:CLAVE_(r[2]),dia:F_FECHA_(r[8])});
  });return result;
}
function F_FORMATOS_(s) {
  F_BLOQUES_(s).forEach(function(b){
    const range=s.getRange(b.row,9,2,3), merges=range.getMergedRanges();
    if(merges.length!==1||merges[0].getRow()!==b.row||merges[0].getColumn()!==9||merges[0].getNumRows()!==2||merges[0].getNumColumns()!==3){
      const values=range.getValues(), formulas=range.getFormulas();
      if(values.some(function(r,i){return r.some(function(v,j){return (i||j)&&(v!==''||formulas[i][j]);});}))throw new Error('REVISAR CONTENIDO PEGADO EN '+range.getA1Notation()+': NO SE BORRARON DATOS');
      range.breakApart().merge();
    }
    range.setNumberFormat('dd/MM/yyyy').setHorizontalAlignment('center').setVerticalAlignment('middle');
    range.setDataValidation(SpreadsheetApp.newDataValidation().requireDate().setAllowInvalid(false).setHelpText('Solo una fecha: dia/mes/ano. El motivo se escribe a la derecha.').build());
  });
}
/** Recupera unicamente una fecha historica comprobada del modulo anterior. */
function F_RECUPERAR_VIGENTE_(s,hoy) {
  const bloques=F_BLOQUES_(s),p=PropertiesService.getScriptProperties(),all=p.getProperties();
  Array.from(new Set(bloques.map(function(b){return b.titulo;}))).forEach(function(t){
    const modules=bloques.filter(function(b){return b.titulo===t;});
    if(modules.some(function(b){return b.dia&&b.dia<=DIA_(hoy);}))return;
    const futuro=modules.filter(function(b){return b.dia&&b.dia>DIA_(hoy);}).sort(function(a,b){return a.dia.localeCompare(b.dia);})[0];
    if(!futuro)return;
    const anterior=modules[(modules.indexOf(futuro)+5)%6],history=[];
    Object.keys(all).filter(function(k){return k.indexOf('CICLO:'+t+':')===0;}).forEach(function(k){history.push.apply(history,JSON.parse(all[k]));});
    const prior=history.filter(function(h){return h.numero===anterior.numero&&h.dia<=DIA_(hoy);}).sort(function(a,b){return b.dia.localeCompare(a.dia);})[0];
    if(!prior)throw new Error('FALTA HISTORIAL VERIFICADO PARA RECUPERAR '+t);
    modules.filter(function(b){return b.dia;}).forEach(function(b){p.setProperty('FECHA FUTURA:'+t+':'+b.numero,b.dia);});
    s.getRange(anterior.row,9).setValue(new Date(prior.dia+'T12:00:00-05:00')).setNumberFormat('dd/MM/yyyy').setNote('INICIO VIGENTE RECUPERADO DEL HISTORIAL: '+prior.dia+'. EL SIGUIENTE INICIO ES '+futuro.dia+'.');
  });
}
function F_FECHA_FUTURA_(titulo,numero,inicio) {
  const d=PropertiesService.getScriptProperties().getProperty('FECHA FUTURA:'+titulo+':'+numero);return d&&d>inicio?d:'';
}
function F_BASES_() {
  const s=HOJA_('CUADRO DE INICIOS'),p=PropertiesService.getScriptProperties();
  F_BLOQUES_(s).forEach(function(b){if(!p.getProperty('FECHA PENDIENTE:'+b.row))p.setProperty('FECHA BASE:'+b.row,b.dia||'');});
}
function F_EDITAR_(e) {
  const s=e.range.getSheet(),p=PropertiesService.getScriptProperties();let applied=false;
  F_BLOQUES_(s).forEach(function(b){
    if(e.range.getLastRow()<b.row||e.range.getRow()>b.row+1)return;
    const cell=s.getRange(b.row,9),note=s.getRange(b.row,12),key='FECHA PENDIENTE:'+b.row;
    if(e.range.getColumn()<=11&&e.range.getLastColumn()>=9){
      const base=p.getProperty('FECHA BASE:'+b.row), proposed=F_FECHA_(cell.getValue());
      if(base===null)throw new Error('INSTALAR CONTROL DE FECHAS ANTES DE EDITAR');
      if(proposed!==base){
        cell.setValue(base?new Date(base+'T12:00:00-05:00'):'');
        if(proposed!==null){p.setProperty(key,JSON.stringify({old:base,next:proposed}));note.setValue('MOTIVO OBLIGATORIO: cambio a '+(proposed||'sin fecha')).setBackground('#fff2cc').setWrap(true).setNote('Escriba aqui la razon. La fecha anterior se conserva hasta completar el motivo.');}
        else s.getParent().toast('Fecha no valida. Use dia/mes/ano. Se conservo la fecha anterior.');
      }
    }
    if(e.range.getColumn()<=12&&e.range.getLastColumn()>=12&&p.getProperty(key)){
      const reason=TEXTO_(note.getValue());if(!reason||reason.indexOf('MOTIVO OBLIGATORIO:')===0)return;
      const change=JSON.parse(p.getProperty(key));
      const audit={old:change.old,next:change.next,reason:reason,at:new Date().toISOString(),by:e.user?e.user.getEmail():''};
      p.setProperty('FECHA CAMBIO:'+b.row,JSON.stringify(audit));
      cell.setValue(change.next?new Date(change.next+'T12:00:00-05:00'):'').setNote('CAMBIO: '+change.old+' -> '+change.next+'\nMOTIVO: '+reason+'\n'+audit.at);
      note.setBackground('#e2f0d9');p.deleteProperty(key);p.setProperty('FECHA BASE:'+b.row,change.next);applied=true;
    }
  });
  F_FORMATOS_(s);
  if(applied){RENOVAR_CUADROS_INICIOS_(new Date());F_BASES_();O_ACTUALIZAR_WHATSAPP_(new Date());C_SINCRONIZAR_CUADRO_();}
}
function RESTAURAR_FORMATO_INICIOS(e) {
  if(e&&e.source&&e.source.getId()!==V2.id)return;
  if(e&&e.changeType&&e.changeType!=='FORMAT'&&e.changeType!=='OTHER')return;
  BLOQUEO_(function(){F_FORMATOS_(HOJA_('CUADRO DE INICIOS'));});
}
function INSTALAR_CONTROL_FECHAS() {
  BLOQUEO_(function(){F_RECUPERAR_VIGENTE_(HOJA_('CUADRO DE INICIOS'),new Date());RENOVAR_CUADROS_INICIOS_(new Date());F_FORMATOS_(HOJA_('CUADRO DE INICIOS'));F_BASES_();});
  if(!ScriptApp.getProjectTriggers().some(function(t){return t.getHandlerFunction()==='RESTAURAR_FORMATO_INICIOS';}))ScriptApp.newTrigger('RESTAURAR_FORMATO_INICIOS').forSpreadsheet(V2.id).onChange().create();
  console.log('CONTROL INSTALADO: dd/MM/yyyy, I:K EN DOS FILAS, MOTIVO OBLIGATORIO EN L.');
}
