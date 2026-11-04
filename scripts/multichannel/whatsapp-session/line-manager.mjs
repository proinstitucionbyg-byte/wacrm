import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {sessionScope} from './store.mjs';

// A local account owns this registry. Each runtime still owns its isolated store lock.
export async function openLineManager({accountId,primary,createRuntime,createOfflineReader,registryPath,maxActive=10}) {
  sessionScope(accountId,primary.lineKey);
  if(!Number.isInteger(maxActive)||maxActive<1||maxActive>10)throw Error('Límite de sesiones inválido.');
  const valid=row=>{sessionScope(accountId,row.lineKey);if(typeof row.label!=='string'||!row.label.trim()||row.label.length>60)throw Error('Nombre inválido.');return {lineKey:row.lineKey,label:row.label.trim()};};
  let rows=[valid({lineKey:primary.lineKey,label:'Principal'})];
  try {
    const saved=JSON.parse(await readFile(registryPath,'utf8'));
    if(saved.version!==1||saved.accountId!==accountId||!Array.isArray(saved.lines)||saved.lines.length>20)throw Error('Registro de líneas inválido.');
    rows=saved.lines.map(valid);
    if(new Set(rows.map(r=>r.lineKey)).size!==rows.length)throw Error('Líneas duplicadas.');
    if(!rows.some(r=>r.lineKey===primary.lineKey))rows.unshift(valid({lineKey:primary.lineKey,label:'Principal'}));
  }catch(error){if(error.code!=='ENOENT')throw error;}
  const runtimes=new Map([[primary.lineKey,primary.runtime]]);
  const readers=new Map([[primary.lineKey,primary.runtime.chatReader]]);
  let tail=Promise.resolve(),closed=false;
  const serial=fn=>{const task=tail.then(()=>{if(closed)throw Error('Administrador detenido.');return fn();});tail=task.catch(()=>{});return task;};
  const persist=async next=>{
    await mkdir(dirname(registryPath),{recursive:true,mode:0o700});
    const temp=registryPath+'.'+randomUUID()+'.tmp';
    await writeFile(temp,JSON.stringify({version:1,accountId,lines:next}),{mode:0o600,flag:'wx'});
    await rename(temp,registryPath);rows=next;
  };
  return Object.freeze({
    capacity(){return {limit:maxActive,active:runtimes.size};},
    list(){return rows.map(row=>{const state=runtimes.get(row.lineKey)?.adapter.status();return {...row,status:state?.status??'stopped',linkedPhone:state?.linkedPhone??null,active:runtimes.has(row.lineKey)};});},
    get(lineKey=primary.lineKey){
      if(closed)throw Error('Administrador detenido.');
      sessionScope(accountId,lineKey);
      if(!rows.some(row=>row.lineKey===lineKey))throw Error('Línea desconocida.');
      const runtime=runtimes.get(lineKey);if(!runtime)throw Error('Primero conecta esta línea.');return runtime;
    },
    async reader(lineKey=primary.lineKey){
      sessionScope(accountId,lineKey);if(closed||!rows.some(row=>row.lineKey===lineKey))throw Error('Línea desconocida.');
      if(!readers.get(lineKey)&&createOfflineReader)readers.set(lineKey,await createOfflineReader({accountId,lineKey}));
      if(!readers.get(lineKey))throw Error('Sin historial guardado.');return readers.get(lineKey);
    },
    register({label}){return serial(async()=>{
      if(rows.length>=20)throw Error('Se alcanzó el límite de líneas registradas.');
      const row=valid({lineKey:'WA-'+randomUUID(),label});
      if(rows.some(r=>r.label.toLocaleLowerCase()===row.label.toLocaleLowerCase()))throw Error('Ese nombre ya existe.');
      await persist([...rows,row]);return row;
    });},
    connect(lineKey){return serial(async()=>{
      sessionScope(accountId,lineKey);
      if(!rows.some(r=>r.lineKey===lineKey))throw Error('Línea desconocida.');
      if(runtimes.has(lineKey))return {alreadyActive:true};
      if(runtimes.size>=maxActive)throw Error('Límite local: '+maxActive+' sesiones abiertas.');
      const runtime=await createRuntime({accountId,lineKey});
      const state=runtime.adapter.status();
      if(state.accountId!==accountId||state.lineKey!==lineKey){await runtime.stop();throw Error('Sesión de otra cuenta o línea.');}
      runtimes.set(lineKey,runtime);readers.set(lineKey,runtime.chatReader);return {alreadyActive:false};
    });},
    disconnect(lineKey){return serial(async()=>{
      sessionScope(accountId,lineKey);
      if(!rows.some(r=>r.lineKey===lineKey))throw Error('Línea desconocida.');
      const runtime=runtimes.get(lineKey);
      if(runtime){await runtime.stop();runtimes.delete(lineKey);}
      return {stopped:true,profilePreserved:true};
    });},
    unlink(lineKey){return serial(async()=>{
      sessionScope(accountId,lineKey);const runtime=runtimes.get(lineKey);
      if(!rows.some(r=>r.lineKey===lineKey)||typeof runtime?.unlink!=='function')throw Error('Conecta y verifica esta línea antes de desvincularla.');
      const result=await runtime.unlink();if(result?.unlinked!==true)throw Error('No se confirmó la desvinculación.');
      runtimes.delete(lineKey);return{unlinked:true,historyPreserved:true};
    });},
    recover(lineKey){return serial(async()=>{
      sessionScope(accountId,lineKey);
      if(!rows.some(r=>r.lineKey===lineKey))throw Error('Línea desconocida.');
      let runtime=runtimes.get(lineKey),restarted=false;
      const previous=runtime?.adapter.status();
      if(runtime&&!['ready','connecting','awaiting_qr'].includes(previous.status)){
        await runtime.stop();runtimes.delete(lineKey);runtime=null;
      }
      if(!runtime){
        if(runtimes.size>=maxActive)throw Error('Límite local: '+maxActive+' sesiones abiertas.');
        runtime=await createRuntime({accountId,lineKey});const state=runtime.adapter.status();
        if(state.accountId!==accountId||state.lineKey!==lineKey){await runtime.stop();throw Error('Sesión de otra cuenta o línea.');}
        runtimes.set(lineKey,runtime);readers.set(lineKey,runtime.chatReader);restarted=true;
      }
      await runtime.adapter.refreshConnection?.();
      if(runtime.adapter.status().status==='ready')await runtime.adapter.syncPending?.();
      const state=runtime.adapter.status();
      return {status:state.status,restarted,automationPaused:state.automationPaused===true,
        centralSync:state.centralSync,uncertainSends:state.uncertainSends??0,pausedChats:state.pausedChats??0,
        historyPreserved:true,uncertainReplayed:false};
    });},
    async close(){closed=true;await tail;const results=await Promise.allSettled([...runtimes.values()].map(r=>r.stop()));if(results.some(r=>r.status==='rejected'))throw Error('No se confirmó el cierre de todas las líneas.');runtimes.clear();},
  });
}
