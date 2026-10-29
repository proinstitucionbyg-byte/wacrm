import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSessionPhoneResolver } from './phone-resolver.mjs';

test('uses the WhatsApp paired phone for an LID and caches only that verified mapping', async () => {
  let calls = 0;
  const resolve = createSessionPhoneResolver({ client: { getContactById: async id => {
    calls++;
    assert.equal(id, '123456789012345@lid');
    return { id: { server: 'c.us', user: '51900000002' } };
  } } });
  assert.equal(await resolve('123456789012345@lid'), '51900000002');
  assert.equal(await resolve('123456789012345@lid'), '51900000002');
  assert.equal(calls, 1);
});

test('does not infer a phone from an unresolved LID or any other chat type', async () => {
  const resolve = createSessionPhoneResolver({ client: { getContactById: async () => ({ id: { server: 'lid', user: '123456789012345' } }) } });
  assert.equal(await resolve('123456789012345@lid'), null);
  assert.equal(await resolve('123456@g.us'), null);
  assert.equal(await resolve('status@broadcast'), null);
});

test('returns a direct chat phone without asking WhatsApp to resolve it', async () => {
  let calls = 0;
  const resolve = createSessionPhoneResolver({ client: { getContactById: async () => { calls++; throw Error(); } } });
  assert.equal(await resolve('51900000002@c.us'), '51900000002');
  assert.equal(calls, 0);
});
