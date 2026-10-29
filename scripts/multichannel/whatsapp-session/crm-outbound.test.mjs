import test from 'node:test';
import assert from 'node:assert/strict';
import { createCrmOutboundClient, startCrmOutboundPoller } from './crm-outbound.mjs';

const token = `wcm_${'a'.repeat(64)}`;
const accountId = '11111111-1111-4111-8111-111111111111';
const jobId = '22222222-2222-4222-8222-222222222222';
const claimToken = '33333333-3333-4333-8333-333333333333';

test('outbound client validates private config and claims only its configured line', async () => {
  assert.throws(() => createCrmOutboundClient({ origin: 'http://example.test', token, lineKey: 'main' }));
  let sent;
  const client = createCrmOutboundClient({ origin: 'https://crm.example.test', token, lineKey: 'main',
    fetchImpl: async (_url, init) => {
      sent = JSON.parse(init.body);
      return Response.json({ job: { id: jobId, accountId, claimToken, lineKey: 'main', chatId: '51999999999@c.us',
        inboundId: 'inbound-1', body: 'Hola' } });
    } });
  const job = await client.claim();
  assert.equal(job.id, jobId);
  assert.equal(sent.line_key, 'main');
  assert.equal(sent.action, 'claim');
});

test('outbound poller records ambiguous dispatches for review and stops cleanly', async () => {
  const events = [];
  let claimed = false;
  const client = {
    async claim() {
      if (claimed) return null;
      claimed = true;
      return { id: jobId, accountId, claimToken, lineKey: 'main', chatId: '51999999999@c.us', inboundId: 'inbound-1', body: 'Hola' };
    },
    async record(_job, result) { events.push(['record', result.state]); return { recorded: true }; },
  };
  const adapter = { status: () => ({ status: 'ready' }), dispatch: async () => ({ state: 'needs_review' }) };
  const poller = startCrmOutboundPoller({ adapter, client, pollMs: 1000 });
  const deadline = Date.now() + 500;
  while (!events.length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
  await poller.stop();
  assert.deepEqual(events, [['record', 'needs_review']]);
});
