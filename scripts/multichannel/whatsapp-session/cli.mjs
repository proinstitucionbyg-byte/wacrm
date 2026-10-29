import { access, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
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
async function main() {
  const executablePath = await browserPath();
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
  const createRuntime=async({accountId,lineKey,expectedPhone})=>{
    const store=await openSessionStore({baseDir:privateRoot,accountId,lineKey});
    let adapter,outboundPoller;
    try{
    let outboundClient;
    if (ownerConfig.accountId === accountId && ownerConfig.crmOutbound?.enabled === true) {
      try { outboundClient = createCrmOutboundClient({ ...ownerConfig.crmOutbound, lineKey }); }
      catch { console.error('Salida CRM no disponible; las respuestas siguen apagadas.'); }
    }
    const Client = navigationSafeClient(wwebjs.Client);
    const client = new Client({
      authStrategy: new wwebjs.LocalAuth({ clientId: 'worker', dataPath: store.authDir }),
      puppeteer: { executablePath, headless: true, dumpio: false },
      webVersionCache: { type: 'none' },
      takeoverOnConflict: false, qrMaxRetries: 0,
    });
    adapter = createSessionAdapter({ accountId, lineKey, store, client, enabled: true,
      repliesEnabled: Boolean(outboundClient), authorizeReply: outboundClient?.authorizeReply,
      onInbound, expectedPhone });
    const chatReader=createChatReader({client:createCachedChatSource(client),isReady:async()=>{await adapter.refreshConnection();return adapter.status().status==='ready';}});
    void adapter.start();
    if (outboundClient) outboundPoller = startCrmOutboundPoller({ adapter, client: outboundClient,
      onError: () => console.error('Cola de respuestas CRM temporalmente no disponible.') });
    return {adapter,chatReader,stop:async()=>{await outboundPoller?.stop();await adapter.stop();}};
    }catch(error){if(outboundPoller)await outboundPoller.stop();if(adapter)await adapter.stop();else await store.close();throw error;}
  };
  let primary,lineManager,panel;
  try {
    primary=await createRuntime({accountId,lineKey,expectedPhone:values['expected-phone']});
    lineManager=await openLineManager({accountId,primary:{lineKey,runtime:primary},createRuntime,
      registryPath:join(privateRoot,'accounts',accountId,'lines.json')});
    let stopTask;
    const stop = () => stopTask ??= (async () => {
      await panel.close(); await lineManager.close(); process.exitCode = 0;
    })();
    panel = await startSessionPanel({ adapter:primary.adapter, port, onStop: stop, chatReader:primary.chatReader,lineManager, qrToSvg: qr => QRCode.toString(qr, { type: 'svg' }) });
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
main().catch(() => {
  // Raw provider/browser errors can include private session details.
  console.error('No se pudo abrir el ejecutor. Revisa configuración, navegador, puerto e historial de la sesión.');
  process.exitCode = 1;
});
