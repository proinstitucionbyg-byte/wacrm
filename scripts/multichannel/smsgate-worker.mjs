import { createSmsGateQueueBridge } from './smsgate-queue-bridge.mjs';

// Explicit single-cycle runner. No CLI/auto-start and no simulation fallback.
// Startup/supervision is a separate task; callers must schedule this themselves.
export function createSmsGateWorker({ enabled = false, client, reader, transport } = {}) {
  if (!client?.identity || !client?.heartbeat || !reader?.health || !transport?.dispatch) {
    throw Error('Faltan la cola autorizada y el dispositivo SMS.');
  }
  let bridge, busy = false;
  return Object.freeze({
    async runOnce() {
      if (enabled !== true) return 'disabled';
      if (busy) return 'busy';
      busy = true;
      try {
        if (!bridge) {
          const identity = await client.identity();
          bridge = createSmsGateQueueBridge({ enabled: true, ...identity, queue: client.queue,
            revalidate: client.revalidate, transport });
        }
        let ready = false;
        try { ready = (await reader.health())?.status === 'pass'; } catch { /* Fail closed, clear heartbeat. */ }
        await client.heartbeat(ready);
        if (!ready) return 'device_unavailable';
        return await bridge.runOnce();
      } finally { busy = false; }
    },
  });
}
