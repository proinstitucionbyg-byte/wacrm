import {mkdir,readdir,lstat,readFile,rename} from 'node:fs/promises';
import {join} from 'node:path';

// Host must stop the executor and verify exclusive ownership of its volume first.
export async function archiveStoppedLocks(root,{exclusive=false}={}){
 if(!exclusive)throw Error('Exclusive stopped executor required');
 const backup=join(root,'.lock-recovery',String(Date.now()));let moved=0;
 async function archive(path,name,symlink=false){
  let stat;try{stat=await lstat(path);}catch(e){if(e.code==='ENOENT')return;throw e;}
  if(symlink?!stat.isSymbolicLink():!stat.isFile())throw Error('Unexpected lock type');
  await mkdir(backup,{recursive:true,mode:0o700});await rename(path,join(backup,name));moved++;
 }
 for(const dir of await readdir(root,{withFileTypes:true})){
  if(!dir.isDirectory()||!(/^[a-f0-9]{64}$/).test(dir.name))continue;
  const scope=dir.name,base=join(root,scope);
  let selected;try{selected=JSON.parse(await readFile(join(base,'profile-path.json'),'utf8'));}catch(e){if(e.code==='ENOENT')continue;throw e;}
  if(selected.scope!==scope||!['short','legacy'].includes(selected.layout))throw Error('Profile owner mismatch');
  const profile=selected.layout==='short'?join(root,'profiles',scope.slice(0,24)):join(base,'auth');
  if(await readFile(join(profile,'scope.txt'),'utf8')!==scope)throw Error('Profile owner mismatch');
  await archive(join(base,'worker.lock'),scope+'-worker.lock');
  for(const name of ['SingletonLock','SingletonCookie','SingletonSocket'])await archive(join(profile,'session-worker',name),scope+'-'+name,true);
 }
 return {archivedLocks:moved,profilesPreserved:true};
}
