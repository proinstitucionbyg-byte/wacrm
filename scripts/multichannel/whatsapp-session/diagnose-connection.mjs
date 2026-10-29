// Read-only diagnostic of this worker's own isolated browser. No UI actions,
// messages, profile changes, QR refresh, logout or browser close.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { sessionScope } from './store.mjs';
const root=fileURLToPath(new URL('../../../output/multichannel-private/whatsapp-session/',import.meta.url));
let browser;
try {
  const config=JSON.parse(await readFile(join(root,'worker-config.json'),'utf8'));
  const scope=sessionScope(config.accountId,config.lineKey);
  const selected=JSON.parse(await readFile(join(root,scope,'profile-path.json'),'utf8'));
  if(selected.scope!==scope||!['short','legacy'].includes(selected.layout))throw Error('Invalid profile');
  const profile=selected.layout==='short'?join(root,'profiles',scope.slice(0,24)):join(root,scope,'auth');
  if(await readFile(join(profile,'scope.txt'),'utf8')!==scope)throw Error('Invalid owner');
  const port=Number((await readFile(join(profile,'session-worker','DevToolsActivePort'),'utf8')).split('\n')[0]);
  if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid endpoint');
  browser=await puppeteer.connect({browserURL:`http://127.0.0.1:${port}`,protocolTimeout:5000});
  const pages=await browser.pages(),page=pages.find(p=>p.url().startsWith('https://web.whatsapp.com/'));
  if(!page)throw Error('No worker page');
  const state=await page.evaluate(async probeChats=>{
    let socketState=null,hasOwnIdentity=false;
    try{socketState=window.require('WAWebSocketModel').Socket.state??null;}catch{/* Uninitialized page. */}
    try{const me=window.require('WAWebUserPrefsMeUser');hasOwnIdentity=!!(me.getMaybeMePnUser()||me.getMaybeMeLidUser());}catch{/* Unknown. */}
    const result={socketState,hasOwnIdentity,libraryInjected:typeof window.WWebJS!=='undefined'};
    if(probeChats){
      try{const chats=await window.WWebJS.getChats();result.chatCount=chats.length;}
      catch(error){result.chatError=error.name;result.missingProperty=error.message.match(/Cannot read properties of (?:undefined|null) \(reading '([A-Za-z_]{1,60})'\)/)?.[1]??null;result.missingMethod=error.message.match(/([A-Za-z_$][A-Za-z0-9_$.]{0,100}) is not a function/)?.[1]??null;}
    }
    return result;
  },process.argv.includes('--chats'));
  console.log(JSON.stringify({readOnly:true,...state}));
}catch{console.log(JSON.stringify({readOnly:true,status:'unavailable'}));process.exitCode=1;}
finally{await browser?.disconnect();}
