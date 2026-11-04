import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openAutomationControl} from './automation-control.mjs';
const accountId='11111111-1111-4111-8111-111111111111';
async function fixture(fn){const dir=await mkdtemp(join(tmpdir(),'wa-control-'));try{await fn({accountId,path:join(dir,'control.json'),dir});}finally{await rm(dir,{recursive:true,force:true});}}
test('global and per-line pauses persist; lifting global pause preserves individual pauses',()=>fixture(async options=>{
 const control=await openAutomationControl(options);assert.equal(control.isPaused('WA-main'),false);
 const task=control.set({paused:true});assert.equal(control.isPaused('WA-main'),true);await task;
 await control.set({lineKey:'WA-support',paused:true});await control.set({paused:false});
 assert.equal(control.isPaused('WA-main'),false);assert.equal(control.isPaused('WA-support'),true);
 const restored=await openAutomationControl(options);assert.equal(restored.isPaused('WA-support'),true);
 await restored.set({lineKey:'WA-support',paused:false});assert.equal(restored.isPaused('WA-support'),false);
}));
test('a later pause cannot be overwritten by a concurrently saving resume',()=>fixture(async options=>{
 const c=await openAutomationControl(options);await c.set({paused:true});
 const resume=c.set({paused:false}),pause=c.set({paused:true});assert.equal(c.isPaused('WA-main'),true);
 await resume;assert.equal(c.isPaused('WA-main'),true);await pause;
 assert.equal((await openAutomationControl(options)).isPaused('WA-main'),true);
}));
test('broken storage blocks all automation and malformed account records never open',()=>fixture(async options=>{
 await writeFile(options.path,JSON.stringify({version:1,accountId:'other',allPaused:false,pausedLines:[]}));await assert.rejects(openAutomationControl(options));
 const blocked=await openAutomationControl({...options,path:join(options.dir,'missing','record.json')});
 await writeFile(join(options.dir,'missing'),'file');await assert.rejects(blocked.set({paused:true}));assert.equal(blocked.isPaused('WA-main'),true);assert.equal(blocked.status().storageFailure,true);
}));
