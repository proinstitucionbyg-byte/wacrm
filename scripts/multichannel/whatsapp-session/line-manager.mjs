import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {sessionScope} from './store.mjs';

// A local account owns this registry. Each runtime still owns its isolated store lock.
export async function openLineManager({accountId,primary,createRuntime,registryPath,maxActive=3}) {
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
  let tail=Promise.resolve(),closed=false;
  const serial=fn=>{const task=tail.then(()=>{if(closed)throw Error('Administrador detenido.');return fn();});tail=task.catch(()=>{});return task;};
  const persist=async next=>{
    await mkdir(dirname(registryPath),{recursive:true,mode:0o700});
    const temp=registryPath+'.'+randomUUID()+'.tmp';
    await writeFile(temp,JSON.stringify({version:1,accountId,lines:next}),{mode:0o600,flag:'wx'});
    await rename(temp,registryPath);rows=next;
  };
  return Object.freeze({
    list(){return rows.map(row=>({...row,status:runtimes.get(row.lineKey)?.adapter.status().status??'stopped',active:runtimes.has(row.lineKey)}));},
    get(lineKey=primary.lineKey){
      if(closed)throw Error('Administrador detenido.');
      sessionScope(accountId,lineKey);
      if(!rows.some(row=>row.lineKey===lineKey))throw Error('Línea desconocida.');
      const runtime=runtimes.get(lineKey);if(!runtime)throw Error('Primero conecta esta línea.');return runtime;
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
      runtimes.set(lineKey,runtime);return {alreadyActive:false};
    });},
    disconnect(lineKey){return serial(async()=>{
      sessionScope(accountId,lineKey);
      if(!rows.some(r=>r.lineKey===lineKey))throw Error('Línea desconocida.');
      const runtime=runtimes.get(lineKey);
      if(runtime){await runtime.stop();runtimes.delete(lineKey);}
      return {stopped:true,profilePreserved:true};
    });},
    async close(){closed=true;await tail;const results=await Promise.allSettled([...runtimes.values()].map(r=>r.stop()));if(results.some(r=>r.status==='rejected'))throw Error('No se confirmó el cierre de todas las líneas.');runtimes.clear();},
  });
}
