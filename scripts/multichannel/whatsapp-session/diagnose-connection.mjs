// Read-only diagnostic by default. Optional --close-empty-browser closes only
// this worker's verified browser when its sole page is about:blank and the
// matching local panel reports connection_error.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { sessionScope } from './store.mjs';
const root=fileURLToPath(new URL('../../../output/multichannel-private/whatsapp-session/',import.meta.url));
let browser,stage='read_config',pageHosts=[];
try {
  const config=JSON.parse(await readFile(join(root,'worker-config.json'),'utf8'));
  stage='read_profile_selection';
  const scope=sessionScope(config.accountId,config.lineKey);
  const selected=JSON.parse(await readFile(join(root,scope,'profile-path.json'),'utf8'));
  if(selected.scope!==scope||!['short','legacy'].includes(selected.layout))throw Error('Invalid profile');
  stage='verify_profile_scope';
  const profile=selected.layout==='short'?join(root,'profiles',scope.slice(0,24)):join(root,scope,'auth');
  if(await readFile(join(profile,'scope.txt'),'utf8')!==scope)throw Error('Invalid owner');
  const port=Number((await readFile(join(profile,'session-worker','DevToolsActivePort'),'utf8')).split('\n')[0]);
  if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid endpoint');
  stage='connect_worker';
  browser=await puppeteer.connect({browserURL:`http://127.0.0.1:${port}`,protocolTimeout:5000});
  stage='find_whatsapp_page';
  const pages=await browser.pages();
  pageHosts=pages.map(page=>{try{return new URL(page.url()).host||'blank';}catch{return 'blank';}});
  const page=pages.find(p=>p.url().startsWith('https://web.whatsapp.com/'));
  if(!page && process.argv.includes('--close-empty-browser')){
    const pageUrls=await Promise.all(pages.map(item=>item.url()));
    if(pages.length!==1||pageUrls[0]!=='about:blank')throw Error('Browser is not an empty worker page');
    const panel=JSON.parse(await readFile(join(root,scope,'panel-access.json'),'utf8'));
    const origin=new URL(panel.origin);
    if(origin.protocol!=='http:'||origin.hostname!=='127.0.0.1'||origin.pathname!=='/')throw Error('Invalid local panel');
    const statusResponse=await fetch(new URL('/api/status',origin),{headers:{Authorization:`Bearer ${panel.token}`},signal:AbortSignal.timeout(3000)});
    const localStatus=await statusResponse.json();
    if(!statusResponse.ok||localStatus.accountId!==config.accountId||localStatus.lineKey!==config.lineKey||localStatus.status!=='connection_error')throw Error('Local session is not in a failed state');
    await browser.close();browser=null;
    console.log(JSON.stringify({readOnly:false,closed:true,isolatedProfileVerified:true,blankPageOnly:true,panelStatus:'connection_error'}));
  } else if(page && process.argv.includes('--close-connected-worker')){
    if(pages.length!==1)throw Error('Unexpected worker pages');
    const state=await page.evaluate(()=>{
      let socketState=null,hasOwnIdentity=false;
      try{socketState=window.require('WAWebSocketModel').Socket.state??null;}catch{/* Unknown worker state. */}
      try{const me=window.require('WAWebUserPrefsMeUser');hasOwnIdentity=!!(me.getMaybeMePnUser()||me.getMaybeMeLidUser());}catch{/* Unknown worker identity. */}
      return {socketState,hasOwnIdentity};
    });
    if(state.socketState!=='CONNECTED'||!state.hasOwnIdentity)throw Error('Connected owner-bound worker was not verified');
    await browser.close();browser=null;
    console.log(JSON.stringify({readOnly:false,closed:true,profileVerified:true,pageCount:1,workerState:state.socketState}));
  } else if(!page) throw Error('No worker page');
  else {
  stage='inspect_whatsapp_state';
  const state=await page.evaluate(async probeChats=>{
    let socketState=null,hasOwnIdentity=false;
    try{socketState=window.require('WAWebSocketModel').Socket.state??null;}catch{/* Uninitialized page. */}
    try{const me=window.require('WAWebUserPrefsMeUser');hasOwnIdentity=!!(me.getMaybeMePnUser()||me.getMaybeMeLidUser());}catch{/* Unknown. */}
    const result={socketState,hasOwnIdentity,libraryInjected:typeof window.WWebJS!=='undefined'};
    if(probeChats==='message-health'){
      const chats=window.require('WAWebCollections').Chat.getModelsArray();
      const messages=chats.flatMap(chat=>{try{return chat.msgs?.getModelsArray?.()??[];}catch{return [];}});
      const incoming=messages.filter(m=>m.id?.fromMe!==true&&!m.isNotification);
      const newest=list=>Math.max(0,...list.map(m=>Number(m.t)||0));
      const direct=chats.filter(c=>/^\d{5,25}@(c\.us|lid)$/.test(c.id?._serialized??''));
      const directMessages=direct.flatMap(c=>{try{return c.msgs?.getModelsArray?.()??[];}catch{return [];}}).filter(m=>m.id?.fromMe!==true&&!m.isNotification);
      result.messageHealth={browserNow:Date.now(),chats:chats.length,loadedMessages:messages.length,
        loadedIncoming:incoming.length,newestMessageSeconds:newest(messages),newestIncomingSeconds:newest(incoming),
        directChats:direct.length,directIncoming:directMessages.length,newestDirectIncomingSeconds:newest(directMessages),
        directMessagesWithSerializedId:directMessages.filter(m=>typeof m.id?._serialized==='string').length,
        directMessageIdTypes:[...new Set(directMessages.map(m=>typeof m.id))],
        idKeys:directMessages[0]?.id&&typeof directMessages[0].id==='object'?Object.keys(directMessages[0].id):[],
        serializableMessages:directMessages.filter(m=>typeof m.serialize==='function').length,
        serializedIds:directMessages.filter(m=>{try{return typeof m.serialize().id?._serialized==='string';}catch{return false;}}).length,
        stringifiableIds:directMessages.filter(m=>{try{return /^(true|false)_/.test(m.id.toString());}catch{return false;}}).length,
        unreadChats:chats.filter(c=>c.unreadCount>0).length,
        recentIncoming:incoming.filter(m=>Number(m.t)*1000>Date.now()-3600000).length};
    }
    if(probeChats){
      try{const chats=await window.WWebJS.getChats();result.chatCount=chats.length;}
      catch(error){result.chatError=error.name;result.missingProperty=error.message.match(/Cannot read properties of (?:undefined|null) \(reading '([A-Za-z_]{1,60})'\)/)?.[1]??null;result.missingMethod=error.message.match(/([A-Za-z_$][A-Za-z0-9_$.]{0,100}) is not a function/)?.[1]??null;}
    }
    return result;
  },process.argv.includes('--message-health')?'message-health':process.argv.includes('--chats'));
  console.log(JSON.stringify({readOnly:true,...state}));
  }
}catch(error){
  const errorType=error instanceof Error ? error.name : 'UnknownError';
  const code=error&&typeof error==='object'&&'code' in error&&typeof error.code==='string'
    &&['ECONNREFUSED','ECONNRESET','ETIMEDOUT','ENOENT','ERR_INVALID_URL','ERR_INVALID_ARG_TYPE'].includes(error.code)
    ? error.code : undefined;
  const message=error instanceof Error ? error.message : '';
  const category=errorType==='TypeError'
    ? /invalid url/i.test(message) ? 'invalid_debugger_url'
      : /cannot read properties/i.test(message) ? 'debugger_response_incomplete'
        : /connect.*not a function/i.test(message) ? 'puppeteer_connect_unavailable' : 'other_type_error'
    : undefined;
  const safeMessage=message.replace(/\b(?:https?|wss?):\/\/[^\s"'`]+/gi,'<url>')
    .replace(/[A-Z]:\\[^\s"'`]+/gi,'<local-path>').slice(0,160);
  const cause=error&&typeof error==='object'&&'cause' in error?error.cause:null;
  const causeType=cause instanceof Error ? cause.name : undefined;
  const causeCode=cause&&typeof cause==='object'&&'code' in cause&&typeof cause.code==='string'
    &&['ECONNREFUSED','ECONNRESET','ETIMEDOUT','ENOENT'].includes(cause.code) ? cause.code : undefined;
  console.log(JSON.stringify({readOnly:true,status:'unavailable',stage,errorType,...(stage==='find_whatsapp_page'?{pageCount:pageHosts.length,pageHosts}:{}),...(code?{errorCode:code}:{}),...(category?{category}:{}),...(safeMessage?{safeMessage}:{}),...(causeType?{causeType}:{}),...(causeCode?{causeCode}:{})}));
  process.exitCode=1;
}
finally{await browser?.disconnect();}
