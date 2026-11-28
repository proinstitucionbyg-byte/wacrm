import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInboundPoller } from './inbound-poller.mjs';

const now = 1_800_000_000_000;
test('recovers the reconnect gap only as history and emits each ID once',async()=>{
 const old=message('missed-during-restart',{timestamp:(now-90000)/1000}),fresh=message('live-after-restart');
 const historic=[],live=[];
 const poller=createInboundPoller({client:{getChats:async()=>[{id:{_serialized:old.from},recentMessages:[old,fresh]}]},isReady:async()=>true,
  startedAt:now-60000,catchupSince:now-120000,now:()=>now,onMessage:m=>live.push(m),onHistoricalMessage:m=>historic.push(m)});
 assert.equal(await poller.pollOnce(),2);assert.equal(await poller.pollOnce(),0);
 assert.equal(historic[0].__crmHistoryOnly,true);assert.equal(historic[0].id._serialized,'missed-during-restart');
 assert.deepEqual(live,[fresh]);poller.stop();
});
test('rejects unbounded history or recovery without a separate history callback',()=>{
 for(const extra of [{catchupSince:now-3*3600000,onHistoricalMessage(){}},{catchupSince:now-120000}]){
  assert.throws(()=>createInboundPoller({client:{getChats:async()=>[]},isReady:async()=>true,onMessage(){},startedAt:now-60000,...extra}));
 }
});
function message(id, { timestamp = now / 1000, own = false, chat = '133548417802244@lid' } = {}) {
  return { id: { _serialized: id, fromMe: own }, fromMe: own, from: chat, timestamp, body: 'PRUEBA' };
}
function setup(chats, overrides = {}) {
  const captured = [];
  const poller = createInboundPoller({ client: { getChats: async () => chats }, onMessage: item => captured.push(item),
    isReady: async () => true, startedAt: now - 60_000, now: () => now, ...overrides });
  return { poller, captured };
}

test('captures only new direct inbound messages and emits each provider ID once', async () => {
  const incoming = message('new-inbound');
  const { poller, captured } = setup([{ id: { _serialized: incoming.from }, lastMessage: incoming }]);
  assert.equal(await poller.pollOnce(), 1);
  assert.equal(await poller.pollOnce(), 0);
  assert.deepEqual(captured, [incoming]);
  assert.deepEqual(poller.status(), { polls: 2, notReady: 0, lastChatCount: 1, candidates: 1,
    forwarded: 1, errors: 0, lastPollAt: now });
  poller.stop();
});

test('does not replay old messages, outgoing messages, groups, or malformed IDs', async () => {
  const old = message('old-inbound', { timestamp: (now - 60_000) / 1000 });
  const own = message('own-message', { own: true });
  const group = message('group-message', { chat: '123456789@g.us' });
  const bad = message('', {});
  const { poller, captured } = setup([
    { id: { _serialized: old.from }, lastMessage: old },
    { id: { _serialized: own.from }, lastMessage: own },
    { id: { _serialized: group.from }, lastMessage: group },
    { id: { _serialized: 'status@broadcast' }, lastMessage: bad },
  ]);
  assert.equal(await poller.pollOnce(), 0);
  assert.deepEqual(captured, []);
  poller.stop();
});

test('waits for a ready session and does not overlap chat reads', async () => {
  let ready = false, release;
  let reads = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const poller = createInboundPoller({
    client: { getChats: async () => { reads++; await gate; return []; } }, onMessage() {},
    isReady: async () => ready, intervalMs: 1000, startedAt: now - 60_000, now: () => now,
  });
  assert.equal(await poller.pollOnce(), 0);
  ready = true;
  const first = poller.pollOnce();
  assert.equal(await poller.pollOnce(), 0);
  release();
  await first;
  assert.equal(reads, 1);
  poller.stop();
});

test('records a safe failure count when the loaded-chat reader is unavailable', async () => {
  const poller = createInboundPoller({ client: { getChats: async () => { throw Error('private'); } },
    onMessage() {}, isReady: async () => true, startedAt: now - 60_000, now: () => now });
  assert.equal(await poller.pollOnce(), 0);
  assert.equal(poller.status().errors, 1);
  assert.equal(JSON.stringify(poller.status()).includes('private'), false);
  poller.stop();
});
