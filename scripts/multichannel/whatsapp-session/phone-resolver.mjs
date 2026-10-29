const PHONE = /^\d{7,15}$/;
const DIRECT = /^(\d{7,15})@c\.us$/;
const LID = /^\d{5,25}@lid$/;

/** Resolves a WhatsApp LID only when the installed client returns its paired PN. */
export function createSessionPhoneResolver({ client, timeoutMs = 5000, now = Date.now } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 500 || timeoutMs > 15000 || typeof now !== 'function') {
    throw Error('Resolución de contacto inválida.');
  }
  const cache = new Map(), pending = new Map();
  return async function resolvePhone(chatId) {
    const direct = DIRECT.exec(chatId ?? '');
    if (direct) return direct[1];
    if (!LID.test(chatId ?? '') || typeof client?.getContactById !== 'function') return null;
    const cached = cache.get(chatId);
    if (cached && cached.expiresAt > now()) return cached.phone;
    if (pending.has(chatId)) return pending.get(chatId);
    const task = (async () => {
      let timer;
      try {
        const contact = await Promise.race([
          client.getContactById(chatId),
          new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Resolución de WhatsApp agotó el tiempo.')), timeoutMs); }),
        ]);
        const paired = contact?.id?.server === 'c.us' && PHONE.test(contact.id.user ?? '') ? contact.id.user : null;
        cache.set(chatId, { phone: paired, expiresAt: now() + (paired ? 86_400_000 : 15_000) });
        return paired;
      } finally {
        clearTimeout(timer);
        pending.delete(chatId);
      }
    })();
    pending.set(chatId, task);
    return task;
  };
}
