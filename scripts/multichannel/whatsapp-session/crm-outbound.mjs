const TOKEN = /^wcm_[a-f0-9]{64}$/;
const LINE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createCrmOutboundClient({ origin, token, lineKey, fetchImpl = fetch, timeoutMs = 8000 }) {
  let endpoint;
  try {
    const url = new URL(origin);
    const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    if ((!local && url.protocol !== 'https:') || (local && !['http:', 'https:'].includes(url.protocol)) ||
        url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw Error();
    endpoint = new URL('/api/multichannel/whatsapp/outbound', url);
  } catch { throw Error('Configuración privada de salida CRM inválida.'); }
  if (!TOKEN.test(token ?? '') || !LINE.test(lineKey ?? '') || typeof fetchImpl !== 'function' ||
      !Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30000) {
    throw Error('Configuración privada de salida CRM inválida.');
  }

  async function request(payload) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, line_key: lineKey }),
      });
      if (!response.ok) throw Error('La cola CRM no confirmó la acción.');
      const raw = await response.text();
      if (raw.length > 16_000) throw Error('Respuesta de cola demasiado grande.');
      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error();
      return data;
    } catch { throw Error('La cola CRM no está disponible; el estado del envío puede requerir revisión.'); }
    finally { clearTimeout(timer); }
  }

  return Object.freeze({
    async claim() {
      const response = await request({ action: 'claim' });
      if (response.job == null) return null;
      const job = response.job;
      if (!UUID.test(job.id ?? '') || !UUID.test(job.claimToken ?? '') || !UUID.test(job.accountId ?? '') ||
          job.lineKey !== lineKey || !/^\d{7,15}@c\.us$/.test(job.chatId ?? '') ||
          typeof job.inboundId !== 'string' || job.inboundId.length < 1 || job.inboundId.length > 1024 ||
          typeof job.body !== 'string' || !job.body.trim() || job.body.length > 4000) {
        throw Error('La cola devolvió una tarea inválida.');
      }
      return job;
    },
    async authorizeReply(job) {
      const response = await request({ action: 'authorize', job_id: job.id, claim_token: job.claimToken,
        inbound_provider_message_id: job.inboundId, chat_id: job.chatId, body_hash: job.bodyHash });
      return response.permit ?? { allowed: false };
    },
    async record(job, result) {
      const state = result?.state === 'accepted' ? 'accepted'
        : result?.state === 'needs_review' || result?.state === 'already_attempted' ? 'needs_review'
          : ['blocked', 'disabled'].includes(result?.state) ? 'cancelled' : 'needs_review';
      const payload = { action: 'record', job_id: job.id, claim_token: job.claimToken, state };
      if (state === 'accepted' && typeof result.providerId === 'string' && result.providerId.length <= 1024) {
        payload.provider_message_id = result.providerId;
      } else if (state === 'accepted') payload.state = 'needs_review';
      const response = await request(payload);
      if (!response.receipt?.recorded) throw Error('El CRM no confirmó el resultado del envío.');
      return response.receipt;
    },
  });
}

export function startCrmOutboundPoller({ adapter, client, pollMs = 2500, onError = () => {} }) {
  if (!adapter?.status || !adapter?.dispatch || !client?.claim || !client?.record ||
      !Number.isInteger(pollMs) || pollMs < 1000 || pollMs > 30000) throw Error('Configuración del ejecutor de salida inválida.');
  let stopped = false;
  let timer, wake;
  const wait = () => new Promise(resolve => {
    wake = resolve;
    timer = setTimeout(() => { wake = undefined; resolve(); }, pollMs);
  });
  const loop = (async () => {
    while (!stopped) {
      try {
        if (adapter.status().status === 'ready') {
          const job = await client.claim();
          if (job) {
            let result;
            try { result = await adapter.dispatch({ key: job.id, accountId: job.accountId,
              lineKey: job.lineKey, inboundId: job.inboundId, chatId: job.chatId, body: job.body }); }
            catch { result = { state: 'needs_review' }; }
            await client.record(job, result);
          }
        }
      } catch (error) { try { onError(error); } catch { /* Diagnostics must not stop the worker. */ } }
      if (!stopped) await wait();
    }
  })();
  return Object.freeze({ async stop() {
    stopped = true;
    clearTimeout(timer);
    const resume = wake;
    wake = undefined;
    resume?.();
    await loop;
  } });
}
