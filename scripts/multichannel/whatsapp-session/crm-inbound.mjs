const TOKEN = /^wcm_[a-f0-9]{64}$/;
const PHONE = /^\d{7,15}$/;

export function createCrmInboundSync({ origin, token, fetchImpl = fetch, timeoutMs = 8000 }) {
  let endpoint;
  try {
    const url = new URL(origin);
    const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    if ((!local && url.protocol !== 'https:') || (local && !['http:', 'https:'].includes(url.protocol)) ||
        url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw Error();
    endpoint = new URL('/api/multichannel/whatsapp/inbound', url);
  } catch { throw Error('Configuración privada del puente CRM inválida.'); }
  if (!TOKEN.test(token ?? '') || typeof fetchImpl !== 'function' ||
      !Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30000) {
    throw Error('Configuración privada del puente CRM inválida.');
  }

  return async function syncInbound(event) {
    if (!event || !PHONE.test(event.linkedPhone ?? '') || typeof event.lineKey !== 'string' ||
        typeof event.id !== 'string' || !event.id || typeof event.chatId !== 'string' ||
        !Number.isFinite(event.timestamp)) return { state: 'needs_contact_resolution' };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          line_key: event.lineKey, linked_phone: event.linkedPhone,
          provider_message_id: event.id, chat_id: event.chatId,
          occurred_at: new Date(event.timestamp).toISOString(), type: event.type, text: event.text ?? '',
        }),
      });
      if (response.status === 422) return { state: 'needs_contact_resolution' };
      if (!response.ok) throw Error('CRM inbound bridge unavailable');
      const body = await response.json().catch(() => null);
      if (body?.result === 'recorded' || body?.result === 'duplicate') return { state: 'synced' };
      throw Error('CRM inbound bridge did not confirm persistence');
    } catch {
      return { state: 'retry' };
    } finally { clearTimeout(timer); }
  };
}
