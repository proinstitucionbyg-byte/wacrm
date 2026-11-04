import { access, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createRequire } from 'node:module';
import wwebjs from 'whatsapp-web.js';
import QRCode from 'qrcode';
import { openSessionStore, sessionScope } from './store.mjs';
import { createSessionAdapter } from './adapter.mjs';
import { startSessionPanel } from './panel.mjs';
import { navigationSafeClient } from './navigation-client.mjs';
import { createChatReader } from './chat-reader.mjs';
import { createCachedChatSource } from './cached-chat-source.mjs';
import { openLineManager } from './line-manager.mjs';
import { createCrmInboundSync } from './crm-inbound.mjs';
import { createCrmOutboundClient, startCrmOutboundPoller } from './crm-outbound.mjs';
import { createSessionPhoneResolver } from './phone-resolver.mjs';
import { createInboundPoller } from './inbound-poller.mjs';
import { createCampaignClient, startCampaignPoller } from './campaign-client.mjs';
import {openAutomationControl} from './automation-control.mjs';
import {openHistoryArchive,createArchivedReader,archiveJournalMessage} from './history-archive.mjs';
import{retainingLocalAuth}from'./retaining-local-auth.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const privateRoot = join(root, 'output', 'multichannel-private', 'whatsapp-session');
const require = createRequire(import.meta.url);
const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  account: { type: 'string' }, line: { type: 'string' }, port: { type: 'string' }, browser: { type: 'string' },
  'expected-phone': { type: 'string' },
} });
async function browserPath() {
  for (const path of [values.browser, process.env.WACRM_WA_BROWSER,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']) {
    if (path && isAbsolute(path)) { try { await access(path); return path; } catch { /* Try the next installed browser. */ } }
  }
  throw Error('No se encontró Chrome/Edge. Indica su ruta con --browser.');
}
let startupStage='resolve_browser';
async function main() {
  const executablePath = await browserPath();
  startupStage='load_worker_config';
  if (positionals[0] === 'doctor') {
    console.log(JSON.stringify({ dependencyVersion: require('whatsapp-web.js/package.json').version,
      clientAvailable: typeof wwebjs.Client === 'function', browserAvailable: true, sendsEnabled: false,
      networkOpened: false, profileOpened: false }));
    return;
  }
  if (positionals[0] !== 'connect') throw Error('Usa doctor o connect. connect abre una sesión en recepción; no envía mensajes.');
  let saved = {};
  if (!values.account || !values.line) {
    try { saved = JSON.parse(await readFile(join(privateRoot, 'worker-config.json'), 'utf8')); }
    catch { throw Error('Falta seleccionar cuenta y línea mediante --account y --line.'); }
  }
  const accountId = values.account ?? saved.accountId, lineKey = values.line ?? saved.lineKey;
  startupStage='validate_session_scope';
  sessionScope(accountId, lineKey);
  let ownerConfig = {};
  try { ownerConfig = JSON.parse(await readFile(join(privateRoot, 'worker-config.json'), 'utf8')); }
  catch { /* Private bridges remain disabled unless their config is present and valid. */ }
  let onInbound;
  try {
    if (ownerConfig.accountId === accountId && ownerConfig.crmBridge) onInbound = createCrmInboundSync(ownerConfig.crmBridge);
  } catch {
    // A broken or absent optional bridge must never prevent local reception.
    console.error('Puente de recepción CRM no disponible; se conserva la recepción local.');
  }
  const port = Number(values.port ?? 8788);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Puerto inválido.');
  const automationControl=await openAutomationControl({accountId,path:join(privateRoot,'accounts',accountId,'automation-control.json')});
  const createRuntime=async({accountId,lineKey,expectedPhone})=>{
    startupStage='open_session_store';
    const store=await openSessionStore({baseDir:privateRoot,accountId,lineKey});
    let adapter,outboundPoller,inboundPoller,campaignPoller,historyTimer,chatReader;
    try{
    const archive=await openHistoryArchive({accountId,lineKey,path:join(privateRoot,sessionScope(accountId,lineKey),'history.jsonl')});
    for(const row of store.records())if(['inbound','human'].includes(row.kind))await archiveJournalMessage(archive,row.payload);
    let outboundClient;
    let campaignClient;
    if (ownerConfig.accountId === accountId && ownerConfig.crmOutbound?.enabled === true) {
      try { outboundClient = createCrmOutboundClient({ ...ownerConfig.crmOutbound, lineKey }); }
      catch { console.error('Salida CRM no disponible; las respuestas siguen apagadas.'); }
    }
    if(ownerConfig.accountId===accountId&&ownerConfig.campaigns?.enabled===true){
      campaignClient=createCampaignClient({...ownerConfig.campaigns,lineKey});
    }
    const Client = navigationSafeClient(wwebjs.Client);
    const Auth=retainingLocalAuth(wwebjs.LocalAuth);
    startupStage='create_whatsapp_client';
    const client = new Client({
      authStrategy: new Auth({ clientId: 'worker', dataPath: store.authDir }),
      puppeteer: { executablePath, headless: true, dumpio: false },
      webVersionCache: { type: 'none' },
      takeoverOnConflict: false, qrMaxRetries: 0,
    });
    const resolvePhone=createSessionPhoneResolver({client});
    adapter = createSessionAdapter({ accountId, lineKey, store, client, enabled: true,
      repliesEnabled: Boolean(outboundClient), authorizeReply: outboundClient?.authorizeReply,
      onInbound, resolveSenderPhone:resolvePhone, getInboundPollerStatus:()=>inboundPoller?.status()??null, expectedPhone,
      campaignsEnabled:!!campaignClient,authorizeCampaign:campaignClient?.authorize,getAutomationPaused:()=>automationControl.isPaused(lineKey),onArchiveMessage:event=>archiveJournalMessage(archive,event) });
    const chatSource=createCachedChatSource(client);
    const isReady=async()=>{await adapter.refreshConnection();return adapter.status().status==='ready';};
    const liveReader=createChatReader({client:chatSource,isReady,resolvePhone});
    chatReader=createArchivedReader({archive,reader:liveReader,source:chatSource,isReady});
    historyTimer=setInterval(()=>{void chatReader.capture();},10000);historyTimer.unref?.();
    void adapter.start();
    if (outboundClient) outboundPoller = startCrmOutboundPoller({ adapter, client: outboundClient,
      onError: () => console.error('Cola de respuestas CRM temporalmente no disponible.') });
    inboundPoller=createInboundPoller({client:chatSource,onMessage:message=>client.emit('message_create',message),
      isReady:()=>adapter.status().status==='ready'});
    inboundPoller.start();
    if(campaignClient)campaignPoller=startCampaignPoller({adapter,client:campaignClient,onError:()=>console.error('Campañas CRM temporalmente no disponibles.')});
    return {adapter,chatReader,stop:async()=>{clearInterval(historyTimer);inboundPoller?.stop();await campaignPoller?.stop();await outboundPoller?.stop();await chatReader.close();await adapter.stop();},unlink:async()=>{
      const owned=resolve(join(store.authDir,'session-worker'));
      const actual=client.authStrategy?.userDataDir;
      if(typeof actual!=='string'||resolve(actual).toLowerCase()!==owned.toLowerCase())throw Error('Perfil de desvinculación sin dueño confirmado.');
      clearInterval(historyTimer);inboundPoller?.stop();await campaignPoller?.stop();await outboundPoller?.stop();await chatReader.capture();await chatReader.close();return adapter.unlink();
    }};
    }catch(error){clearInterval(historyTimer);if(inboundPoller)inboundPoller.stop();if(campaignPoller)await campaignPoller.stop();if(outboundPoller)await outboundPoller.stop();await chatReader?.close();if(adapter)await adapter.stop();else await store.close();throw error;}
  };
  let primary,lineManager,panel;
  try {
    startupStage='start_whatsapp_adapter';
    primary=await createRuntime({accountId,lineKey,expectedPhone:values['expected-phone']});
    startupStage='open_line_manager';
    lineManager=await openLineManager({accountId,primary:{lineKey,runtime:primary},createRuntime,
      registryPath:join(privateRoot,'accounts',accountId,'lines.json'),
      createOfflineReader:async({accountId,lineKey})=>createArchivedReader({archive:await openHistoryArchive({accountId,lineKey,path:join(privateRoot,sessionScope(accountId,lineKey),'history.jsonl'),readOnly:true}),isReady:async()=>false})});
    let stopTask;
    const stop = () => stopTask ??= (async () => {
      await panel.close(); await lineManager.close(); process.exitCode = 0;
    })();
    startupStage='start_private_panel';
    panel = await startSessionPanel({ adapter:primary.adapter, port, onStop: stop, chatReader:primary.chatReader,lineManager,automationControl, qrToSvg: qr => QRCode.toString(qr, { type: 'svg' }) });
    startupStage='save_panel_access';
    await writeFile(join(privateRoot, sessionScope(accountId,lineKey), 'panel-access.json'), JSON.stringify({ url: panel.url, origin: panel.origin, token: panel.token, pid: process.pid }), { mode: 0o600 });
    console.log('Panel privado local (solo recepción): ' + panel.url);
    const signalStop = () => { void stop().catch(() => { console.error('No se pudo confirmar el cierre del ejecutor.'); process.exitCode = 1; }); };
    process.once('SIGINT', signalStop);
    process.once('SIGTERM', signalStop);
  } catch (error) {
    if (panel) await panel.close();
    if(lineManager)await lineManager.close();else if(primary)await primary.stop();
    throw error;
  }
}
main().catch(error => {
  // Raw provider/browser errors can include private session details.
  const errorType=error instanceof Error?error.name:'UnknownError';
  const code=error&&typeof error==='object'&&'code' in error&&typeof error.code==='string'
    &&['ECONNREFUSED','ECONNRESET','ETIMEDOUT','ENOENT','EACCES','EADDRINUSE','ERR_INVALID_URL','ERR_INVALID_ARG_TYPE'].includes(error.code)
    ? error.code : undefined;
  console.error('No se pudo abrir el ejecutor.',JSON.stringify({stage:startupStage,errorType,...(code?{errorCode:code}:{})}));
  process.exitCode = 1;
});
