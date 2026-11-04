import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {sessionScope} from './store.mjs';

// One account-wide stop switch, independent of each browser's connection.
export async function openAutomationControl({accountId,path}){
 sessionScope(accountId,'WA-control');
 let saved={version:1,accountId,allPaused:false,pausedLines:[]};
 try{
  const value=JSON.parse(await readFile(path,'utf8'));
  if(value.version!==1||value.accountId!==accountId||typeof value.allPaused!=='boolean'||!Array.isArray(value.pausedLines)||value.pausedLines.length>20)throw Error('Control de automatizaciones inválido.');
  for(const line of value.pausedLines)sessionScope(accountId,line);
  saved=value;
 }catch(error){if(error.code!=='ENOENT')throw error;}
 let tail=Promise.resolve(),emergency=false,desired=structuredClone(saved);
 const paused=line=>{sessionScope(accountId,line);return emergency||saved.allPaused||desired.allPaused||saved.pausedLines.includes(line)||desired.pausedLines.includes(line);};
 return Object.freeze({
  isPaused:paused,
  status:()=>({allPaused:emergency||saved.allPaused||desired.allPaused,pausedLines:[...new Set([...saved.pausedLines,...desired.pausedLines])],storageFailure:emergency}),
  set({lineKey,paused:pause}){
   if(typeof pause!=='boolean')return Promise.reject(Error('Estado de pausa inválido.'));
   if(lineKey!==undefined)sessionScope(accountId,lineKey);
   // Stop immediately, even while an authorization request is in progress.
   const next=lineKey===undefined?{...desired,allPaused:pause}:{...desired,pausedLines:pause?[...new Set([...desired.pausedLines,lineKey])]:desired.pausedLines.filter(line=>line!==lineKey)};
   desired=next;
   const task=tail.then(async()=>{
    const temp=path+'.'+randomUUID()+'.tmp';
    try{await mkdir(dirname(path),{recursive:true,mode:0o700});await writeFile(temp,JSON.stringify(next),{mode:0o600,flag:'wx'});await rename(temp,path);saved=next;emergency=false;}
    catch{emergency=true;throw Error('No se guardó el control. Las automatizaciones quedan detenidas por seguridad.');}
    return {allPaused:saved.allPaused,pausedLines:[...saved.pausedLines],storageFailure:false};
   });tail=task.catch(()=>{});return task;
  },
 });
}
