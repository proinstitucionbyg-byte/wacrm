import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { openSessionStore, sessionScope } from './store.mjs';
const accountId=randomUUID(),lineKey='WA-fictional';
async function fixture(fn) {
  const baseDir=await mkdtemp(join(tmpdir(),'wacrm-wa-test-'));
  try { await fn({baseDir,accountId,lineKey}); }
  finally {
    assert.ok(resolve(baseDir).startsWith(resolve(tmpdir()) + '\\wacrm-wa-test-') || resolve(baseDir).startsWith(resolve(tmpdir()) + '/wacrm-wa-test-'));
    await rm(baseDir,{recursive:true,force:true});
  }
}
test('scope rejects traversal and separates account and line',()=>{
  assert.throws(()=>sessionScope(accountId,'../private'));
  assert.notEqual(sessionScope(accountId,lineKey),sessionScope(randomUUID(),lineKey));
  assert.notEqual(sessionScope(accountId,lineKey),sessionScope(accountId,'WA-other'));
});
test('one local owner per browser profile',()=>fixture(async config=>{
  const one=await openSessionStore(config);
  try { await assert.rejects(openSessionStore(config),/bloqueada/); } finally { await one.close(); }
  const next=await openSessionStore(config); await next.close();
}));
test('durable ordered records survive restart without sharing mutable state',()=>fixture(async config=>{
  const one=await openSessionStore(config);
  await Promise.all([one.append('human',{chatId:'fictional'}),one.append('attempt',{key:'one'})]);
  const copy=one.records(); copy[0].payload.chatId='tampered';
  await one.close();
  const two=await openSessionStore(config);
  try { assert.deepEqual(two.records().map(r=>r.kind),['human','attempt']); assert.equal(two.records()[0].payload.chatId,'fictional'); }
  finally { await two.close(); }
}));
test('partial journal fails closed and is never overwritten',()=>fixture(async config=>{
  const one=await openSessionStore(config); const path=join(config.baseDir,one.scope,'events.jsonl'); await one.close();
  await writeFile(path,'{"partial":');
  await assert.rejects(openSessionStore(config),/historial privado/);
  assert.equal(await readFile(path,'utf8'),'{"partial":');
}));
test('a journal copied from another scope is rejected',()=>fixture(async config=>{
  const one=await openSessionStore(config); const path=join(config.baseDir,one.scope,'events.jsonl'); await one.close();
  await writeFile(path,JSON.stringify({scope:'wrong',seq:1,kind:'human',payload:{}})+'\n');
  await assert.rejects(openSessionStore(config),/historial privado/);
}));
test('closed store cannot accept a new send attempt',()=>fixture(async config=>{
  const store=await openSessionStore(config); await store.close();
  await assert.rejects(store.append('attempt',{key:'blocked'}));
}));
test('short browser profile remains stable after binding and restart',()=>fixture(async config=>{
  const first=await openSessionStore(config),path=first.authDir;
  await first.append('binding',{phone:'51900000001'});await first.close();
  const next=await openSessionStore(config);try{assert.equal(next.authDir,path);}finally{await next.close();}
}));
test('a browser profile with a mismatched full scope cannot be opened',()=>fixture(async config=>{
  const first=await openSessionStore(config),path=join(first.authDir,'scope.txt');await first.close();
  await writeFile(path,'other-account');await assert.rejects(openSessionStore(config),/historial privado/);
}));
