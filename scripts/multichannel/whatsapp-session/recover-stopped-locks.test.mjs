import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {archiveStoppedLocks} from './recover-stopped-locks.mjs';
test('requires exclusive stopped executor and preserves profiles and messages',async()=>{
 const root=await mkdtemp(join(tmpdir(),'wa-lock-'));try{
 const scope='a'.repeat(64),base=join(root,scope),profile=join(root,'profiles',scope.slice(0,24));
 await mkdir(base,{recursive:true});await mkdir(join(profile,'session-worker'),{recursive:true});
 await writeFile(join(base,'profile-path.json'),JSON.stringify({scope,layout:'short'}));await writeFile(join(profile,'scope.txt'),scope);
 await writeFile(join(base,'worker.lock'),'old-token');await writeFile(join(base,'events.jsonl'),'history');await writeFile(join(profile,'session-worker','credentials'),'keep');
 await assert.rejects(archiveStoppedLocks(root),/Exclusive/);
 assert.equal((await archiveStoppedLocks(root,{exclusive:true})).archivedLocks,1);
 assert.equal(await readFile(join(base,'events.jsonl'),'utf8'),'history');assert.equal(await readFile(join(profile,'session-worker','credentials'),'utf8'),'keep');
 assert.equal((await archiveStoppedLocks(root,{exclusive:true})).archivedLocks,0);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('refuses mismatched ownership without releasing the lock',async()=>{
 const root=await mkdtemp(join(tmpdir(),'wa-owner-'));try{const base=join(root,'b'.repeat(64));await mkdir(base);await writeFile(join(base,'profile-path.json'),JSON.stringify({scope:'other',layout:'short'}));await writeFile(join(base,'worker.lock'),'keep');await assert.rejects(archiveStoppedLocks(root,{exclusive:true}),/owner/);assert.equal(await readFile(join(base,'worker.lock'),'utf8'),'keep');}finally{await rm(root,{recursive:true,force:true});}
});
