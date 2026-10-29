import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openLineManager} from './line-manager.mjs';
const accountId='4d761b3c-4c6c-4986-bcd8-d95f1754fe35';
async function fixture(fn){
  const dir=await mkdtemp(join(tmpdir(),'wa-lines-')),registryPath=join(dir,'lines.json');let created=0,stopped=0;
  const runtime=lineKey=>({adapter:{status:()=>({accountId,lineKey,status:'connecting'})},chatReader:{},stop:async()=>{stopped++;}});
  const options={accountId,registryPath,primary:{lineKey:'WA-main',runtime:runtime('WA-main')},createRuntime:async({lineKey})=>{created++;return runtime(lineKey);},maxActive:2};
  const manager=await openLineManager(options);
  try{await fn({manager,options,registryPath,created:()=>created,stopped:()=>stopped});}finally{await manager.close();await rm(dir,{recursive:true,force:true});}
}
test('registering a line persists metadata without opening WhatsApp',()=>fixture(async x=>{
  const row=await x.manager.register({label:'Soporte'});assert.equal(x.created(),0);assert.equal(x.manager.list()[1].status,'stopped');
  const restored=await openLineManager(x.options);assert.equal(restored.list()[1].lineKey,row.lineKey);await restored.close();
}));
test('different lines use different runtimes and concurrent duplicate connects open one',()=>fixture(async x=>{
  const row=await x.manager.register({label:'Ventas'});await Promise.all([x.manager.connect(row.lineKey),x.manager.connect(row.lineKey)]);
  assert.equal(x.created(),1);assert.notEqual(x.manager.get(row.lineKey),x.manager.get('WA-main'));
}));
test('capacity and unknown line are rejected before opening a browser',()=>fixture(async x=>{
  const a=await x.manager.register({label:'A'}),b=await x.manager.register({label:'B'});await x.manager.connect(a.lineKey);
  await assert.rejects(x.manager.connect(b.lineKey),/Límite/);await assert.rejects(x.manager.connect('WA-unknown'),/desconocida/);assert.equal(x.created(),1);
}));
test('duplicate names, traversal and malformed account registry fail closed',()=>fixture(async x=>{
  await x.manager.register({label:'Soporte'});await assert.rejects(x.manager.register({label:' soporte '}),/existe/);
  assert.throws(()=>x.manager.get('../profile'));await writeFile(x.registryPath,JSON.stringify({version:1,accountId:'other',lines:[]}));
  await assert.rejects(openLineManager(x.options),/inválido/);
}));
test('a factory cannot attach a runtime for another account or line',()=>fixture(async x=>{
  const other=await openLineManager({...x.options,createRuntime:async()=>x.options.primary.runtime});
  const row=await other.register({label:'Otra'});await assert.rejects(other.connect(row.lineKey),/otra cuenta/);await other.close();
}));
test('stopping one line preserves registration and frees capacity without stopping another',()=>fixture(async x=>{
  const a=await x.manager.register({label:'A'}),b=await x.manager.register({label:'B'});await x.manager.connect(a.lineKey);
  const result=await x.manager.disconnect(a.lineKey);assert.equal(result.profilePreserved,true);assert.equal(x.stopped(),1);
  assert.equal(x.manager.get('WA-main').adapter.status().lineKey,'WA-main');assert.equal(x.manager.list()[1].active,false);
  await x.manager.connect(b.lineKey);assert.equal(x.created(),2);
}));
