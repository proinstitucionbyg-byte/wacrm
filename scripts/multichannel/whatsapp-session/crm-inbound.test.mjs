import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCrmInboundSync } from './crm-inbound.mjs';

const token = `wcm_${'a'.repeat(64)}`;
const event = { id:'provider-1',lineKey:'WA-test',linkedPhone:'51911111111',chatId:'51922222222@c.us',
  timestamp:Date.parse('2026-10-29T08:00:00Z'),type:'chat',text:'Mensaje ficticio' };

test('sends only bounded message metadata to the authenticated CRM intake',async()=>{
  const calls=[];const sync=createCrmInboundSync({origin:'https://crm.example',token,fetchImpl:async(url,options)=>{
    calls.push({url:String(url),options});return new Response(JSON.stringify({result:'duplicate'}),{status:200});
  }});
  assert.deepEqual(await sync(event),{state:'synced'});
  assert.equal(calls[0].url,'https://crm.example/api/multichannel/whatsapp/inbound');
  assert.equal(calls[0].options.headers.Authorization,`Bearer ${token}`);
  assert.deepEqual(JSON.parse(calls[0].options.body),{
    line_key:event.lineKey,linked_phone:event.linkedPhone,provider_message_id:event.id,
    chat_id:event.chatId,occurred_at:'2026-10-29T08:00:00.000Z',type:'chat',text:event.text,
  });
  assert.equal(calls[0].options.redirect,'error');
});

test('treats LID resolution as a review item and keeps transport errors retryable',async()=>{
  const unresolved=createCrmInboundSync({origin:'https://crm.example',token,fetchImpl:async()=>new Response('{}',{status:422})});
  assert.deepEqual(await unresolved({...event,chatId:'123456789@lid'}),{state:'needs_contact_resolution'});
  const failed=createCrmInboundSync({origin:'https://crm.example',token,fetchImpl:async()=>{throw Error('private');}});
  assert.deepEqual(await failed(event),{state:'retry'});
  assert.deepEqual(await failed({...event,linkedPhone:''}),{state:'needs_contact_resolution'});
});

test('refuses untrusted origins, credentials and malformed worker tokens',()=>{
  assert.throws(()=>createCrmInboundSync({origin:'http://crm.example',token}));
  assert.throws(()=>createCrmInboundSync({origin:'https://user:pass@crm.example',token}));
  assert.throws(()=>createCrmInboundSync({origin:'https://crm.example/path',token}));
  assert.throws(()=>createCrmInboundSync({origin:'https://crm.example',token:'secret'}));
});
