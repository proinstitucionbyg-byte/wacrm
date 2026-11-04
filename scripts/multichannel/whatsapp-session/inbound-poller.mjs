const CHAT_ID = /^\d{5,25}@(c\.us|lid)$/;
const MESSAGE_ID = value => typeof value === 'string' && value.length > 0 && value.length <= 1024;

/** Fallback for inbound events missed by WhatsApp Web's event bridge.
 * Reads every already-loaded direct message after startup, so a newer outgoing
 * message cannot hide an inbound one before the next poll. Historical messages
 * are never replayed into CRM automation.
 */
export function createInboundPoller({ client, onMessage, isReady, intervalMs = 5000,
  startedAt = Date.now(), now = Date.now } = {}) {
  if (typeof client?.getChats !== 'function' || typeof onMessage !== 'function' || typeof isReady !== 'function' ||
      !Number.isInteger(intervalMs) || intervalMs < 1000 || intervalMs > 30_000 ||
      !Number.isFinite(startedAt) || typeof now !== 'function') throw Error('Configuración de recepción inválida.');

  let stopped = false, polling = false, timer = null;
  const forwarded = new Set();
  const diagnostics = { polls: 0, notReady: 0, lastChatCount: 0, candidates: 0, forwarded: 0, errors: 0, lastPollAt: null };
  async function pollOnce() {
    if (stopped || polling) return 0;
    polling = true;
    diagnostics.polls++;
    diagnostics.lastPollAt = now();
    let count = 0;
    try {
      if (!await isReady()) { diagnostics.notReady++; return 0; }
      const chats = await client.getChats({ after: startedAt });
      diagnostics.lastChatCount = Array.isArray(chats) ? chats.length : 0;
      for (const chat of Array.isArray(chats) ? chats : []) {
        const id = chat?.id?._serialized;
        if (!CHAT_ID.test(id ?? '')) continue;
        const messages = Array.isArray(chat?.recentMessages) ? chat.recentMessages : [chat?.lastMessage];
        for (const message of messages) {
          const messageId = message?.id?._serialized;
          const timestamp = Number(message?.timestamp) * 1000;
          if (!MESSAGE_ID(messageId) || message.fromMe === true || message.id?.fromMe === true ||
              !Number.isFinite(timestamp) || timestamp <= startedAt || timestamp > now() + 300_000 ||
              forwarded.has(messageId)) continue;
          diagnostics.candidates++;
          onMessage(message);
          forwarded.add(messageId);
          if (forwarded.size > 5000) forwarded.delete(forwarded.values().next().value);
          count++;
        }
      }
      diagnostics.forwarded += count;
      return count;
    } catch { diagnostics.errors++; return count; }
    finally { polling = false; }
  }
  return Object.freeze({
    start() {
      if (stopped || timer) return;
      timer = setInterval(() => { void pollOnce(); }, intervalMs);
      timer.unref?.();
      void pollOnce();
    },
    pollOnce,
    status() { return { ...diagnostics }; },
    stop() { stopped = true; if (timer) clearInterval(timer); timer = null; },
  });
}
