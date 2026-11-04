import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSmsGateTransport, fileDispatchJournal } from './smsgate-transport.mjs';

const config = { baseUrl: 'http://192.168.1.5:8080', username: 'sms', password: 'fake',
  deviceKey: 'fictional-device', enabled: true, simReady: true };
const job = { key: 'campaign-student-version', purpose: 'collection', recipient: '+51900000001',
  body: 'Ejemplo ficticio', runAt: '2026-10-26T10:00:00Z', expiresAt: '2026-10-26T12:00:00Z' };
const eligibility = { allowed: true, paused: false, permissionConfirmed: true, paymentStatus: 'pending' };
const now = () => Date.parse('2026-10-26T11:00:00Z');
async function setup(t, overrides = {}, fetchImpl) {
  const directory = await mkdtemp(join(tmpdir(), 'wcm-transport-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const journal = fileDispatchJournal(directory);
  return { journal, client: createSmsGateTransport({ ...config, ...overrides }, { journal, fetchImpl, now }) };
}

test('202 es aceptado; consulta posterior distingue Sent y Delivered', async t => {
  let body, remoteState = 'Sent';
  const { client } = await setup(t, {}, async (url, init) => {
    assert.equal(init.redirect, 'error');
    if (init.method === 'POST') {
      body = JSON.parse(init.body);
      assert.equal(url.pathname, '/message');
      return Response.json({ id: body.id, state: 'Delivered' }, { status: 202 });
    }
    return Response.json({ id: body.id, state: remoteState });
  });
  assert.equal((await client.dispatch(job, eligibility)).state, 'accepted');
  assert.equal(body.ttl, 3600);
  assert.deepEqual(body.phoneNumbers, [job.recipient]);
  assert.equal((await client.reconcile(job.key)).state, 'sent');
  remoteState = 'Delivered';
  assert.equal((await client.reconcile(job.key)).state, 'delivered');
});

test('dos ejecutores comparten reserva; cambio de linea no repite POST', async t => {
  let posts = 0;
  const fetchImpl = async (_, init) => { posts++; return Response.json({ id: JSON.parse(init.body).id }, { status: 202 }); };
  const { client, journal } = await setup(t, {}, fetchImpl);
  const second = createSmsGateTransport({ ...config, deviceKey: 'other-device' }, { journal, fetchImpl, now });
  const results = await Promise.all([client.dispatch(job, eligibility), second.dispatch(job, eligibility)]);
  assert.equal(posts, 1);
  assert.deepEqual(results.map(x => x.state).sort(), ['accepted', 'already_attempted']);
});

test('timeout, 500 y respuesta incorrecta conservan reserva sin reintento', async t => {
  for (const failure of ['timeout', 'server', 'wrong_id']) {
    let posts = 0;
    const { client } = await setup(t, {}, async (_, init) => {
      if (init.method === 'GET') return new Response('', { status: 404 });
      posts++;
      if (failure === 'timeout') throw Error('secret provider details');
      if (failure === 'server') return new Response('secret', { status: 500 });
      return Response.json({ id: 'wrong' }, { status: 202 });
    });
    assert.equal((await client.dispatch(job, eligibility)).state, 'needs_review');
    assert.equal((await client.reconcile(job.key)).state, 'needs_review');
    assert.equal((await client.dispatch(job, eligibility)).state, 'already_attempted');
    assert.equal(posts, 1);
  }
});

test('pausa, pago resuelto, falta de consentimiento, SIM o activacion bloquean sin red', async t => {
  const noNetwork = async () => { assert.fail('No debe enviar'); };
  const { client } = await setup(t, {}, noNetwork);
  for (const patch of [{ paused: true }, { paymentStatus: 'resolved' }, { paymentStatus: 'unknown' },
    { permissionConfirmed: false }, { allowed: false }]) {
    assert.equal((await client.dispatch(job, { ...eligibility, ...patch })).state, 'blocked');
  }
  for (const patch of [{ enabled: false }, { simReady: false }]) {
    const { client: disabled } = await setup(t, patch, noNetwork);
    assert.equal((await disabled.dispatch(job, eligibility)).state, 'blocked');
  }
});

test('fecha futura, vencida y destinatario invalido no envian', async t => {
  const { client } = await setup(t, {}, async () => assert.fail('No debe enviar'));
  assert.equal((await client.dispatch({ ...job, runAt: '2026-10-27T10:00:00Z' }, eligibility)).state, 'not_due');
  assert.equal((await client.dispatch({ ...job, expiresAt: '2026-10-26T10:00:00Z' }, eligibility)).state, 'expired');
  await assert.rejects(client.dispatch({ ...job, recipient: 'unknown' }, eligibility), /invalidos/);
});

test('fallo del diario previo impide POST; fallo posterior nunca reporta entregado', async () => {
  let posts = 0;
  const fetchImpl = async (_, init) => { posts++; return Response.json({ id: JSON.parse(init.body).id }, { status: 202 }); };
  const journal = { read() {}, update() { throw Error('disk'); }, reserve() { throw Error('disk'); } };
  const client = createSmsGateTransport(config, { journal, fetchImpl, now });
  await assert.rejects(client.dispatch(job, eligibility), /disk/);
  assert.equal(posts, 0);
  journal.reserve = async () => true;
  assert.equal((await client.dispatch(job, eligibility)).state, 'needs_review');
  assert.equal(posts, 1);
});
