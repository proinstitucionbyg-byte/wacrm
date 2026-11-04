import { createServer } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { sessionPage as page } from './panel-page.mjs';
import {participantCsv} from './history-archive.mjs';

const requestIdPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function startSessionPanel({ adapter, qrToSvg, port = 8788, onStop, chatReader, lineManager, automationControl }) {
  if (!Number.isInteger(port) || port < 0 || port > 65535 || !adapter?.status || !qrToSvg) throw Error('Panel local inválido.');
  const token = randomBytes(32).toString('base64url');
  let origin;
  const server = createServer(async (request, response) => {
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' };
    const send = (code, body, type = 'application/json') => { response.writeHead(code, { ...headers, 'Content-Type': type }); response.end(body); };
    try {
      if (request.headers.host !== new URL(origin).host || (request.headers.origin && request.headers.origin !== origin)) return send(403, '{}');
      if (!['GET', 'POST'].includes(request.method)) return send(405, '{}');
      if (new URL(request.url,origin).pathname === '/' && request.method === 'GET') {
        const nonce = randomBytes(18).toString('base64');
        headers['Content-Security-Policy'] = `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src 'self' blob:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;
        return send(200, page(nonce), 'text/html; charset=utf-8');
      }
      const credential = Buffer.from((request.headers.authorization ?? '').replace(/^Bearer /, ''));
      if (credential.length !== Buffer.byteLength(token) || !timingSafeEqual(credential, Buffer.from(token))) return send(401, '{}');
      const url=new URL(request.url,origin);
      if(url.pathname==='/api/automation'&&automationControl){
        if(request.method==='GET')return send(200,JSON.stringify(automationControl.status()));
        if(request.headers['content-type']!=='application/json')return send(415,'{}');
        let size=0;const chunks=[];for await(const chunk of request){size+=chunk.length;if(size>512)return send(413,'{}');chunks.push(chunk);}
        let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return send(400,'{}');}
        if(!body||typeof body.paused!=='boolean'||!['all','line'].includes(body.scope)||Object.keys(body).some(k=>!['scope','paused','line_key'].includes(k)))return send(400,'{}');
        if(body.scope==='line'&&(!lineManager||!lineManager.list().some(r=>r.lineKey===body.line_key)))return send(400,'{}');
        if(body.scope==='all'&&body.line_key!==undefined)return send(400,'{}');
        const changed=await automationControl.set({paused:body.paused,...(body.scope==='line'?{lineKey:body.line_key}:{})});
        if(!body.paused&&lineManager){for(const row of lineManager.list()){
          if(row.active&&!automationControl.isPaused(row.lineKey)){
            try{void Promise.resolve(lineManager.get(row.lineKey).adapter.syncPending?.()).catch(()=>{});}catch{/* The existing retry journal preserves pending messages. */}
          }
        }}
        return send(200,JSON.stringify(changed));
      }
      if(lineManager&&request.method==='POST'&&/^\/api\/lines\/[^/]+\/recover$/.test(url.pathname)){
        try{return send(200,JSON.stringify(await lineManager.recover(decodeURIComponent(url.pathname.split('/')[3]))));}
        catch{return send(409,JSON.stringify({error:'No se completó la recuperación. Se conserva el perfil; revisa el estado de esta línea.'}));}
      }
      if(url.pathname==='/api/lines'&&request.method==='GET'){
        const state=adapter.status();
        return send(200,JSON.stringify({defaultLine:lineManager?.defaultLine?.()??state.lineKey,canManage:!!lineManager,automation:automationControl?.status()??null,capacity:lineManager?.capacity?.()??{limit:1,active:1},lines:lineManager?.list()??[{lineKey:state.lineKey,label:state.lineKey,status:state.status,active:true}]}));
      }
      if(lineManager&&request.method==='POST'&&url.pathname==='/api/lines'){
        if(request.headers['content-type']!=='application/json')return send(415,'{}');
        let size=0;const chunks=[];
        for await(const chunk of request){size+=chunk.length;if(size>1024)return send(413,'{}');chunks.push(chunk);}
        let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return send(400,'{}');}
        try{return send(201,JSON.stringify(await lineManager.register({label:body?.label})));}
        catch{return send(400,JSON.stringify({error:'Nombre inválido, repetido o límite de líneas alcanzado.'}));}
      }
      if(lineManager&&request.method==='POST'&&/^\/api\/lines\/[^/]+\/connect$/.test(url.pathname)){
        try{return send(202,JSON.stringify(await lineManager.connect(decodeURIComponent(url.pathname.split('/')[3]))));}
        catch{return send(409,JSON.stringify({error:'No se pudo abrir esa línea. Revisa sesiones activas, perfil y límite local.'}));}
      }
      if(lineManager&&request.method==='POST'&&/^\/api\/lines\/[^/]+\/stop$/.test(url.pathname)){
        try{return send(200,JSON.stringify(await lineManager.disconnect(decodeURIComponent(url.pathname.split('/')[3]))));}
        catch{return send(409,JSON.stringify({error:'No se confirmó el cierre de esa línea. Se conserva su perfil.'}));}
      }
      if(lineManager&&request.method==='POST'&&/^\/api\/lines\/[^/]+\/replace$/.test(url.pathname)){
        if(request.headers['content-type']!=='application/json')return send(415,'{}');
        let size=0;const chunks=[];for await(const chunk of request){size+=chunk.length;if(size>256)return send(413,'{}');chunks.push(chunk);}
        let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return send(400,'{}');}
        if(body?.confirmed!==true)return send(400,JSON.stringify({error:'Confirma el cambio de número.'}));
        try{return send(201,JSON.stringify(await lineManager.replace(decodeURIComponent(url.pathname.split('/')[3]))));}
        catch{return send(409,JSON.stringify({error:'No se completó el cambio. Revisa las líneas; el historial anterior se conserva.'}));}
      }
      if(lineManager&&request.method==='POST'&&/^\/api\/lines\/[^/]+\/unlink$/.test(url.pathname)){
        if(request.headers['content-type']!=='application/json')return send(415,'{}');
        let size=0;const chunks=[];for await(const chunk of request){size+=chunk.length;if(size>256)return send(413,'{}');chunks.push(chunk);}
        let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return send(400,'{}');}
        if(body?.confirmed!==true)return send(400,JSON.stringify({error:'Confirma la desvinculación de esta línea.'}));
        try{return send(200,JSON.stringify(await lineManager.unlink(decodeURIComponent(url.pathname.split('/')[3]))));}
        catch{return send(409,JSON.stringify({error:'No se confirmó la desvinculación. Revisa la conexión de esa línea.'}));}
      }
      if (request.method === 'POST' && request.url === '/api/stop' && onStop) {
        send(202, '{"stopping":true}');
        setTimeout(() => { Promise.resolve().then(onStop).catch(() => {}); }, 50);
        return;
      }
      let currentAdapter=adapter,currentReader=chatReader;
      const selectedLine=url.searchParams.get('line');
      if(lineManager&&!selectedLine){try{const current=lineManager.get(adapter.status().lineKey);currentAdapter=current.adapter;currentReader=current.chatReader;}catch{/* A stopped default line still reports its stopped state. */}}
      if(selectedLine){
        if(lineManager){try{const runtime=lineManager.get(selectedLine);currentAdapter=runtime.adapter;currentReader=runtime.chatReader;}catch{
          try{currentReader=await lineManager.reader(selectedLine);currentAdapter={status:()=>({accountId:adapter.status().accountId,lineKey:selectedLine,status:'stopped',received:0,automationPaused:automationControl?.isPaused(selectedLine)??false}),qr:()=>null};}
          catch{return send(404,'{}');}
        }}
        else if(selectedLine!==adapter.status().lineKey)return send(404,'{}');
      }
      if (request.method === 'POST' && url.pathname === '/api/send') {
        if (!currentAdapter?.sendManual || !currentReader?.assertSendable) return send(503, JSON.stringify({error:'Esta línea no permite enviar desde el panel.'}));
        if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')) return send(415, '{}');
        let size=0;const chunks=[];
        for await(const chunk of request){size+=chunk.length;if(size>8192)return send(413,'{}');chunks.push(chunk);}
        let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return send(400,'{}');}
        if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.request_id !== 'string' ||
            !requestIdPattern.test(body.request_id) || typeof body.chat_id !== 'string' || typeof body.text !== 'string' ||
            !body.text.trim() || body.text.length>4000) return send(400,'{}');
        try {
          const result=await currentAdapter.sendManual({requestId:body.request_id,chatId:body.chat_id,body:body.text,
            authorizeTarget:async chatId=>{await currentReader.assertSendable(chatId);return true;}});
          const code=({accepted:200,needs_review:202,already_attempted:409,request_conflict:409,blocked:403,disabled:409})[result?.state]??409;
          return send(code,JSON.stringify(result));
        } catch { return send(400,JSON.stringify({error:'No se pudo validar el mensaje. Revisa la conversación y el texto.'})); }
      }
      if (request.method !== 'GET') return send(405, '{}');
      if(url.pathname==='/api/history/export'&&currentReader?.exportHistory){
        headers['Content-Disposition']='attachment; filename="whatsapp-history.json"';
        return send(200,JSON.stringify(await currentReader.exportHistory()),'application/json; charset=utf-8');
      }
      if(url.pathname==='/api/chats'&&currentReader){
        const offset=Number(url.searchParams.get('offset')??0);
        if(!Number.isInteger(offset)||offset<0||offset>50000)return send(400,'{}');
        return send(200,JSON.stringify(await currentReader.list({offset,limit:20,search:url.searchParams.get('search')??'',kind:url.searchParams.get('kind')??'all'})));
      }
      if(/^\/api\/chats\/[^/]+\/members(?:\.csv)?$/.test(url.pathname)&&currentReader?.members){
        const csv=url.pathname.endsWith('.csv'),id=decodeURIComponent(url.pathname.split('/')[3]);
        const data=await currentReader.members(id);
        if(csv){headers['Content-Disposition']='attachment; filename="participantes.csv"';return send(200,participantCsv(data),'text/csv; charset=utf-8');}
        return send(200,JSON.stringify(data));
      }
      if(url.pathname.startsWith('/api/chats/')&&currentReader){
        return send(200,JSON.stringify(await currentReader.messages(decodeURIComponent(url.pathname.slice('/api/chats/'.length)))));
      }
      if (url.pathname === '/api/status') {
        await currentAdapter.refreshConnection?.();
        return send(200, JSON.stringify(currentAdapter.status()));
      }
      if (url.pathname === '/api/qr') {
        const image = currentAdapter.qrImage?.();
        const qr = image || currentAdapter.qr();
        if (!qr) return send(404, '{}');
        headers.ETag = '"' + createHash('sha256').update(qr).digest('hex') + '"';
        if (request.headers['if-none-match'] === headers.ETag) return send(304, '');
        return image ? send(200, Buffer.from(image.slice('data:image/png;base64,'.length), 'base64'), 'image/png')
          : send(200, await qrToSvg(qr), 'image/svg+xml');
      }
      return send(404, '{}');
    } catch { if (!response.headersSent) send(503, '{}'); else response.end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  return { url: `${origin}/#${token}`, origin, token,
    async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}
