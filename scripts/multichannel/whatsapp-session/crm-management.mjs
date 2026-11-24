const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LINE=/^WA-[A-Za-z0-9_-]{1,60}$/;

export async function executeManagementCommand(manager,command,accountId){
 if(!command||!UUID.test(command.id??'')||command.account_id!==accountId||command.status!=='running')throw Error('Acción fuera de esta cuenta.');
 const op=command.operation;
 if(!['create','connect','stop','unlink','recover','recover_all','replace','group_list','group_details','group_mutate'].includes(op))throw Error('Acción no admitida.');
 if(op==='recover_all'){
  const targets=manager.list().filter(item=>!item.archived&&!item.label.startsWith('Historial ')&&item.active);
  const results=[];
  for(const target of targets){try{await manager.recover(target.lineKey);results.push({lineKey:target.lineKey,ok:true});}catch{results.push({lineKey:target.lineKey,ok:false});}}
  const recovered=results.filter(item=>item.ok).length;
  return `Recuperación general completada: ${recovered} de ${targets.length} líneas revisadas. Actualiza para ver cuáles necesitan QR.`;
 }
 if(op==='create'){
  if(typeof command.label!=='string'||!command.label.trim()||command.label.length>60)throw Error('Nombre inválido.');
  const line=await manager.register({label:command.label});await manager.connect(line.lineKey);return 'Línea creada. Espera su QR en el CRM.';
 }
 if(!LINE.test(command.line_key??''))throw Error('Línea inválida.');
 const line=manager.list().find(l=>l.lineKey===command.line_key);if(!line)throw Error('Línea desconocida.');
 if(op.startsWith('group_')){
  if(line.archived||line.label.startsWith('Historial ')||!line.active||line.status!=='ready'||!command.expected_phone||line.linkedPhone!==command.expected_phone)throw Error('Línea de grupos no disponible o número cambiado.');
  const runtime=manager.get(line.lineKey);if(typeof runtime.getGroupController!=='function')throw Error('Grupos todavía no habilitados en este ejecutor.');
  const groups=await runtime.getGroupController(command.expected_phone),p=command.payload;
  if(!p||typeof p!=='object')throw Error('Solicitud de grupos inválida.');
  if(op==='group_list'&&p.kind==='list')return{message:'Grupos consultados.',data:{kind:'list',...await groups.list({offset:p.offset,limit:p.limit,search:p.search})}};
  if(op==='group_details'&&p.kind==='details')return{message:'Grupo consultado.',data:{kind:'details',...await groups.details(p.group_id,{includeMessages:p.include_messages===true})}};
  if(op==='group_mutate'&&p.kind==='mutate'&&p.change)return{message:'Revisa el resultado de la acción del grupo.',data:{kind:'mutation',...await groups.mutate({requestId:command.id,groupId:p.group_id,operation:p.change.operation,value:p.change.value})}};
  throw Error('Solicitud de grupos inválida.');
 }
 if((line.archived===true||line.label.startsWith('Historial '))&&op!=='stop')throw Error('El historial es de solo consulta.');
 if(['unlink','replace'].includes(op)&&(!command.expected_phone||line.linkedPhone!==command.expected_phone))throw Error('El teléfono cambió; actualiza antes de continuar.');
 if(op==='connect'){await manager.connect(line.lineKey);return 'Línea abierta. Comprueba su estado o escanea su QR.';}
 if(op==='stop'){await manager.disconnect(line.lineKey);return 'Línea detenida. Se conservan el vínculo y el historial.';}
 if(op==='unlink'){await manager.unlink(line.lineKey);await manager.connect(line.lineKey);return 'Escanea el QR con el mismo número. Se conserva la tarjeta y su historial.';}
 if(op==='replace'){const next=await manager.replace(line.lineKey);await manager.connect(next.lineKey);return 'Perfil nuevo abierto. El historial anterior se conserva separado.';}
 await manager.recover(line.lineKey);return 'Revisión completada. Las pausas y los envíos inciertos se conservan.';
}

export async function managementSnapshot(manager,qrToDataUrl){
 return Promise.all(manager.list().map(async line=>{
  let qr=null;
  if(!line.archived&&!line.label.startsWith('Historial ')&&line.active&&line.status==='awaiting_qr'){
   const adapter=manager.get(line.lineKey).adapter;
   qr=adapter.qrImage?.()??null;
   if(!qr){const raw=adapter.qr?.();if(raw)qr=await qrToDataUrl(raw);}
   if(typeof qr!=='string'||qr.length>200000||!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(qr))qr=null;
  }
  return {lineKey:line.lineKey,label:line.label,archived:line.archived===true||line.label.startsWith('Historial '),status:line.status,active:line.active,linkedPhone:line.linkedPhone??null,qr};
 }));
}

export function startCrmManagement({accountId,origin,token,manager,qrToDataUrl,fetchImpl=fetch,pollMs=3000,onError=()=>{},onFatal=()=>{},maxFailures=6}){
 const url=new URL(origin);
 if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash||!/^wcm_[a-f0-9]{64}$/.test(token??'')||!UUID.test(accountId)||!Number.isInteger(pollMs)||pollMs<1000)throw Error('Configuración de gestión inválida.');
 const endpoint=new URL('/api/multichannel/whatsapp/manage',url);
 let stopped=false,timer,wake,completed,failures=0;
 const wait=()=>new Promise(resolve=>{wake=resolve;timer=setTimeout(()=>{wake=undefined;resolve();},pollMs);});
 const loop=(async()=>{while(!stopped){let flushReadResult=false;try{
  const lines=await managementSnapshot(manager,qrToDataUrl);
  const response=await fetchImpl(endpoint,{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},signal:AbortSignal.timeout(20000),body:JSON.stringify({lines,...(completed?{completed}:{})})});
  if(!response.ok)throw Error('Gestión no disponible.');
  const raw=await response.text();if(raw.length>20000)throw Error('Respuesta inválida.');const data=JSON.parse(raw);
  if(data.accountId!==accountId)throw Error('Cuenta no reconocida.');
  if(completed){if(data.acknowledged!==completed.id)throw Error('Resultado pendiente de confirmar.');completed=undefined;}
  if(data.command){
   const command=data.command;if(!UUID.test(command.id??'')||command.account_id!==accountId)throw Error('Acción fuera de esta cuenta.');
   // A claimed action is never replayed automatically if its outcome is lost.
   try{const result=await executeManagementCommand(manager,command,accountId);completed={id:command.id,status:typeof result==='object'&&result.data?.kind==='mutation'&&result.data.state!=='done'?'needs_review':'done',result:typeof result==='string'?result:result.message,...(typeof result==='object'?{result_data:result.data}:{})};}
   catch{completed={id:command.id,status:command.operation==='group_mutate'?'needs_review':'error',result:'No se completó la acción. Revisa el estado y el número de esta línea antes de volver a intentarlo.'};}
  }
  failures=0;if(completed&&['group_list','group_details'].includes(data.command?.operation))flushReadResult=true;
 }catch{failures++;onError();if(failures>=maxFailures){onFatal();return;}}if(!stopped&&!flushReadResult)await wait();}})();
 return {async stop(){stopped=true;clearTimeout(timer);wake?.();await loop;}};
}
