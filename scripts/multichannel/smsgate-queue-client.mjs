// Client for the SMS server routes. No polling loop or automatic activation.
export function createSmsQueueClient({ baseUrl, token, lineKey, deviceKey, fetchImpl = fetch } = {}) {
  let base;
  try { base = new URL(baseUrl); } catch { throw Error('URL de WACRM inválida.'); }
  if ((base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(base.hostname))) ||
    base.username || base.password || base.search || base.hash || !/^wcm_[a-f0-9]{64}$/.test(token ?? '') ||
    !/^SMS-[A-Za-z0-9_-]{1,60}$/.test(lineKey ?? '') || typeof deviceKey !== 'string' || !deviceKey || deviceKey.length > 160) {
    throw Error('Configuración de cola SMS inválida. Usa HTTPS y la credencial de esta laptop.');
  }
  const endpoint = new URL('/api/multichannel/sms/worker', base);
  async function call(action, payload = {}) {
    let response;
    try {
      response = await fetchImpl(endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, action, line_key: lineKey, device_key: deviceKey }) });
    } catch { throw Error('No se confirmó la respuesta de la cola SMS.'); }
    if (!response.ok) {
      await response.body?.cancel();
      const error = Error([401,403].includes(response.status) ? 'Laptop o línea no autorizada.' : 'Cola SMS no disponible.');
      error.code = [401,403].includes(response.status) ? 'REVOKED' : 'UNAVAILABLE';
      throw error;
    }
    let result;
    try { result = await response.json(); } catch { throw Error('Respuesta de cola SMS inválida.'); }
    if (result?.mode !== 'sms_live') throw Error('La cola respondió en otro modo; no se enviará.');
    return result;
  }
  const ref = job => ({ job_id: job.job_id ?? job.id, claim_token: job.claim_token });
  return Object.freeze({
    async identity() {
      const data = (await call('identity')).identity;
      if (!data || data.lineKey !== lineKey || data.deviceKey !== deviceKey) throw Error('Identidad de línea inválida.');
      return Object.freeze({ ...data });
    },
    async heartbeat(ready) {
      if (typeof ready !== 'boolean') throw Error('Disponibilidad inválida.');
      if ((await call('heartbeat', { ready })).heartbeat?.recorded !== true) throw Error('Salud no confirmada por el servidor.');
    },
    queue: Object.freeze({
      async claim() { return (await call('claim')).job ?? null; },
      async start(job) { return (await call('start', ref(job))).job ?? null; },
      async recordResult(result) {
        return (await call('record', { ...ref(result), provider_id: result.provider_id,
          state: result.state, checked_at: result.checked_at })).receipt ?? { recorded: false };
      },
    }),
    async revalidate(job) { return (await call('permit', ref(job))).permit ?? { allowed: false }; },
  });
}
