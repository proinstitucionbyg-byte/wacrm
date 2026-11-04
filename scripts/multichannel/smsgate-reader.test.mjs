import test from 'node:test';
import assert from 'node:assert/strict';
import { createSmsGateReader } from './smsgate-reader.mjs';

const config = {
  baseUrl: 'http://192.168.100.45:8080', deviceKey: 'example-device',
  username: 'example-user', password: 'example-secret',
};
const period = {
  from: '2026-10-25T14:00:00-05:00', to: '2026-10-26T15:00:00-05:00',
  allowedSenders: ['+51900000001'],
};
const sms = {
  id: 'text:1', type: 'SMS', sender: '900000001',
  contentPreview: 'Ok', createdAt: '2026-10-25T14:45:00-05:00',
};
const reply = rows => new Response(JSON.stringify(rows), {
  status: 200, headers: { 'X-Total-Count': String(rows.length) },
});

test('solo acepta direcciones locales explicitas, sin claves en URL ni rutas externas', () => {
  for (const baseUrl of ['https://example.com', 'http://8.8.8.8',
    'http://user:secret@192.168.1.2', 'http://192.168.1.2/other',
    'http://192.168.1.2?secret=value', 'http://192.168.1.2#secret']) {
    assert.throws(() => createSmsGateReader({ ...config, baseUrl }), /configuracion/i);
  }
});

test('lee SMS y texto de MMS sin excluir la respuesta observada en el telefono', async () => {
  const mms = { ...sms, id: 'mms:50', type: 'MMS_DOWNLOADED', sender: '+51900000001' };
  const client = createSmsGateReader(config, { fetchImpl: async () => reply([sms, mms]) });
  const result = await client.replies(period);
  assert.equal(result.messages.length, 2);
  assert.equal(result.messages[1].type, 'MMS_DOWNLOADED');
  assert.equal(result.messages[1].text, 'Ok');
  assert.equal(result.messages[0].sender, '+51900000001');
});

test('exige rango de fechas explicito, limita pagina y no descarga adjuntos', async () => {
  let seen;
  const client = createSmsGateReader(config, { fetchImpl: async (url, init) => {
    seen = { url: new URL(url), init }; return reply([]);
  } });
  await client.replies(period);
  assert.equal(seen.url.pathname, '/inbox');
  assert.equal(seen.url.searchParams.get('type'), null);
  assert.equal(seen.url.searchParams.get('includeAttachments'), 'false');
  assert.equal(seen.url.searchParams.get('from'), period.from);
  assert.equal(seen.url.searchParams.get('to'), period.to);
  assert.equal(seen.init.method, 'GET');
  assert.equal(seen.init.redirect, 'error');
  await assert.rejects(client.replies({ ...period, to: undefined }), /fechas/i);
  await assert.rejects(client.replies({ ...period, limit: 501 }), /pagina/i);
});

test('no devuelve conversaciones de otros numeros ni notificaciones sin contenido descargado', async () => {
  const rows = [sms, { ...sms, sender: '+51900000002' }, { ...sms, type: 'MMS' }];
  const client = createSmsGateReader(config, { fetchImpl: async () => reply(rows) });
  assert.equal((await client.replies(period)).messages.length, 1);
  await assert.rejects(client.replies({ ...period, allowedSenders: [] }), /remitentes/i);
});

test('identidad incluye dispositivo y contexto, no solo el ID MMS local', async () => {
  const fetchImpl = async () => reply([sms, sms]);
  const first = createSmsGateReader(config, { fetchImpl });
  const second = createSmsGateReader({ ...config, deviceKey: 'another-device' }, { fetchImpl });
  const a = await first.replies(period), b = await second.replies(period);
  assert.equal(a.messages.length, 1);
  assert.notEqual(a.messages[0].key, b.messages[0].key);
});

test('no reintenta ni expone credenciales o cuerpo de error del proveedor', async () => {
  let calls = 0;
  const client = createSmsGateReader(config, { fetchImpl: async () => {
    calls++; return new Response('example-secret', { status: 401 });
  } });
  await assert.rejects(client.health(), error => {
    assert.equal(error.status, 401);
    assert.equal(error.message.includes('example-secret'), false);
    return true;
  });
  assert.equal(calls, 1);
});

test('fallo de red y JSON invalido quedan como errores de lectura, nunca envios', async () => {
  for (const fetchImpl of [
    async () => { throw new Error('example-secret'); },
    async () => new Response('not JSON', { status: 200 }),
  ]) {
    const client = createSmsGateReader(config, { fetchImpl });
    await assert.rejects(client.health(), error => !error.message.includes('example-secret'));
  }
});

test('conserva paginacion aunque una pagina solo contenga remitentes excluidos', async () => {
  const client = createSmsGateReader(config, { fetchImpl: async () => new Response(
    JSON.stringify([{ ...sms, sender: '+51900000002' }]),
    { status: 200, headers: { 'X-Total-Count': '3' } },
  ) });
  const result = await client.replies({ ...period, limit: 1 });
  assert.equal(result.messages.length, 0);
  assert.equal(result.nextOffset, 1);
});

test('consulta una entrega por identificador sin llamar a POST ni construir IDs de otro destino', async () => {
  let seen;
  const client = createSmsGateReader(config, { fetchImpl: async (url, init) => {
    seen = { url: new URL(url), init }; return reply({ id: 'test-1', state: 'Sent' });
  } });
  assert.equal((await client.messageStatus('test-1')).state, 'Sent');
  assert.equal(seen.url.pathname, '/message/test-1');
  assert.equal(seen.init.method, 'GET');
  await assert.rejects(client.messageStatus('../inbox'), /identificador/i);
});
