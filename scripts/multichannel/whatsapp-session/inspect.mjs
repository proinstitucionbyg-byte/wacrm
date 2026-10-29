// Local health/QR inspection; never prints token, QR content, phone or messages.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { sessionScope } from './store.mjs';
const directory = fileURLToPath(new URL('../../../output/multichannel-private/whatsapp-session/', import.meta.url));
try {
  const config = JSON.parse(await readFile(join(directory, 'worker-config.json'), 'utf8'));
  const panel = JSON.parse(await readFile(join(directory, sessionScope(config.accountId, config.lineKey), 'panel-access.json'), 'utf8'));
  const origin = new URL(panel.origin);
  if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || origin.username || origin.password || origin.pathname !== '/') throw Error('Invalid local panel');
  const options = { headers: { Authorization: `Bearer ${panel.token}` }, redirect: 'error', signal: AbortSignal.timeout(5000) };
  if (process.argv.includes('--stop')) {
    const response = await fetch(new URL('/api/stop', origin), { ...options, method: 'POST' });
    console.log(JSON.stringify({ closeRequested: response.status === 202 }));
  } else {
    const response = await fetch(new URL('/api/status', origin), options);
    if (!response.ok) throw Error('Unavailable');
    const status = await response.json();
    const qr = status.status === 'awaiting_qr' ? await fetch(new URL('/api/qr', origin), options) : null;
    console.log(JSON.stringify({ status: status.status, connectionReason: status.connectionReason,
      qrAvailable: qr?.status === 200, qrIsSvg: qr?.headers.get('content-type') === 'image/svg+xml',
      repliesEnabled: status.repliesEnabled, receivedCount: status.received }));
    await qr?.body?.cancel();
  }
} catch { console.log(JSON.stringify({ status: 'unavailable' })); process.exitCode = 1; }
