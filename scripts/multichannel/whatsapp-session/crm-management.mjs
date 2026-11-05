const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LINE=/^WA-[A-Za-z0-9_-]{1,60}$/;

export async function executeManagementCommand(manager,command,accountId){
 if(!command||!UUID.test(command.id??'')||command.account_id!==accountId||command.status!=='running')throw Error('Acción fuera de esta cuenta.');
 const op=command.operation;
 if(!['create','connect','stop','unlink','recover','replace'].includes(op))throw Error('Acción no admitida.');
 if(op==='create'){
  if(typeof command.label!=='string'||!command.label.trim()||command.label.length>60)throw Error('Nombre inválido.');
  const line=await manager.register({label:command.label});await manager.connect(line.lineKey);return 'Línea creada. Espera su QR en el CRM.';
 }
 if(!LINE.test(command.line_key??''))throw Error('Línea inválida.');
 const line=manager.list().find(l=>l.lineKey===command.line_key);if(!line)throw Error('Línea desconocida.');
 if((line.archived===true||line.label.startsWith('Historial '))&&op!=='stop')throw Error('El historial es de solo consulta.');
 if(['unlink','replace'].includes(op)&&(!command.expected_phone||line.linkedPhone!==command.expected_phone))throw Error('El teléfono cambió; actualiza antes de continuar.');
 if(op==='connect'){await manager.connect(line.lineKey);return 'Línea abierta. Comprueba su estado o escanea su QR.';}
 if(op==='stop'){await manager.disconnect(line.lineKey);return 'Línea detenida. Se conservan el vínculo y el historial.';}
 if(op==='unlink'){await manager.unlink(line.lineKey);return 'Vínculo revocado. El historial se conserva.';}
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

export function startCrmManagement({accountId,origin,token,manager,qrToDataUrl,fetchImpl=fetch,pollMs=3000,onError=()=>{}}){
 const url=new URL(origin);
 if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash||!/^wcm_[a-f0-9]{64}$/.test(token??'')||!UUID.test(accountId)||!Number.isInteger(pollMs)||pollMs<1000)throw Error('Configuración de gestión inválida.');
 const endpoint=new URL('/api/multichannel/whatsapp/manage',url);
 let stopped=false,timer,wake,completed;
 const wait=()=>new Promise(resolve=>{wake=resolve;timer=setTimeout(()=>{wake=undefined;resolve();},pollMs);});
 const loop=(async()=>{while(!stopped){try{
  const lines=await managementSnapshot(manager,qrToDataUrl);
  const response=await fetchImpl(endpoint,{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},signal:AbortSignal.timeout(20000),body:JSON.stringify({lines,...(completed?{completed}:{})})});
  if(!response.ok)throw Error('Gestión no disponible.');
  const raw=await response.text();if(raw.length>20000)throw Error('Respuesta inválida.');const data=JSON.parse(raw);
  if(data.accountId!==accountId)throw Error('Cuenta no reconocida.');
  if(completed){if(data.acknowledged!==completed.id)throw Error('Resultado pendiente de confirmar.');completed=undefined;}
  if(data.command){
   const command=data.command;if(!UUID.test(command.id??'')||command.account_id!==accountId)throw Error('Acción fuera de esta cuenta.');
   // A claimed action is never replayed automatically if its outcome is lost.
   try{const result=await executeManagementCommand(manager,command,accountId);completed={id:command.id,status:'done',result};}
   catch{completed={id:command.id,status:'error',result:'No se completó la acción. Revisa el estado y el número de esta línea antes de volver a intentarlo.'};}
  }
 }catch{onError();}if(!stopped)await wait();}})();
 return {async stop(){stopped=true;clearTimeout(timer);wake?.();await loop;}};
}
