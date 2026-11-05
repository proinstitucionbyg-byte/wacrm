import{test}from'node:test';import assert from'node:assert/strict';import{runInNewContext}from'node:vm';
import{resumeAlreadySyncedSession}from'./synced-session.mjs';
function setup({connected=true,synced=true,phone=true,injected=false}={}){
 let calls=0;const window={require:name=>name==='WAWebSocketModel'?{Socket:{state:connected?'CONNECTED':'UNPAIRED',hasSynced:synced}}:{getMaybeMePnUser:()=>phone?{server:'c.us',user:'51900000001'}:null},...(injected?{WWebJS:{getMessageModel(){}}}:{}),onAppStateHasSyncedEvent:async()=>{calls++;window.WWebJS={getMessageModel(){}};}};
 const run=runInNewContext('('+resumeAlreadySyncedSession.toString()+')',{window});return{window,run,calls:()=>calls};
}
test('an already synchronized paired session installs the vendor reader once without linking again',async()=>{const s=setup();assert.deepEqual(await Promise.all([s.run(),s.run()]),[true,true]);assert.equal(s.calls(),1);assert.equal(await s.run(),false);});
test('an unpaired, unsynchronized or already injected session cannot replay authentication',async()=>{for(const options of [{connected:false},{synced:false},{phone:false},{injected:true}]){const s=setup(options);assert.equal(await s.run(),false);assert.equal(s.calls(),0);}});
