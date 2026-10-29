import { createHash } from 'node:crypto';
import { sessionScope } from './store.mjs';

const replyChatPattern = /^\d{5,20}@(c\.us|lid)$/;
const manualChatPattern = /^\d{5,25}@(c\.us|lid|g\.us)$/;
const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const idValid = id => typeof id === 'string' && id.length > 0 && id.length <= 1024;
export const replyBodyHash = body => createHash('sha256').update(body).digest('hex');

function snapshot(message, now) {
  const own = message?.fromMe === true || message?.id?.fromMe === true;
  const chatId = own ? message.to : message?.from;
  const timestamp = Number(message?.timestamp) * 1000;
  if (!idValid(message?.id?._serialized) || !manualChatPattern.test(chatId ?? '') ||
      !Number.isFinite(timestamp) || timestamp < Date.UTC(2009, 0, 1) || timestamp > now + 300_000) return null;
  return { id: message.id._serialized, chatId, own, timestamp,
    text: typeof message.body === 'string' ? message.body.slice(0, 65536) : '',
    type: typeof message.type === 'string' ? message.type.slice(0, 32) : 'unknown',
    hasMedia: message.hasMedia === true };
}

/** Real client adapter. No automatic rule/AI response or Cloud API fallback.
 * A send requires an injected, fresh CRM policy; the CLI supplies none. */
export function createSessionAdapter({ accountId, lineKey, client, store, enabled = false,
  repliesEnabled = false, authorizeReply, onInbound, resolveSenderPhone, expectedPhone, now = Date.now, startupTimeoutMs = 90_000 }) {
  if (store?.scope !== sessionScope(accountId, lineKey) || !client?.on || !client?.initialize || !client?.sendMessage) {
    throw Error('Falta la sesión aislada y su cliente.');
  }
  if (expectedPhone !== undefined && !/^\d{7,15}$/.test(expectedPhone)) throw Error('Número esperado inválido.');
  if (!Number.isInteger(startupTimeoutMs) || startupTimeoutMs < 1 || startupTimeoutMs > 180_000) throw Error('Tiempo de arranque inválido.');
  let status = 'stopped', connectionReason = null, qr = null, binding = null, tail = Promise.resolve(), started = false, stopping = false;
  let readySignalSeen = false, socketState = null;
  const incoming = new Map(), seen = new Set(), paused = new Set(), attempts = new Map(), manualAttempts = new Map(), bots = new Map(), pendingHuman = new Map();
  const crmSync = new Map(), crmSyncPhones = new Map(), phoneByChat = new Map(), crmSyncInFlight = new Map();
  let crmSyncTail = Promise.resolve();
  function canonicalChatId(chatId) {
    if (chatId?.endsWith('@c.us')) return chatId;
    const phone = phoneByChat.get(chatId);
    return phone ? `${phone}@c.us` : chatId;
  }
  function apply(record) {
    const p = record.payload;
    if (record.kind === 'binding') {
      if (!/^\d{7,15}$/.test(p.phone ?? '') || (binding && binding !== p.phone)) throw Error('Identidad persistida inválida.');
      binding = p.phone;
    } else if (record.kind === 'inbound' || record.kind === 'human') {
      if (!idValid(p.id) || !manualChatPattern.test(p.chatId ?? '') || typeof p.text !== 'string') throw Error('Historial de mensajes inválido.');
      seen.add(p.id);
      if (record.kind === 'inbound') {
        incoming.set(p.id, p);
        if (/^\d{7,15}$/.test(p.senderPhone ?? '')) phoneByChat.set(p.chatId, p.senderPhone);
      }
      else paused.add(p.chatId);
    } else if (record.kind === 'crm_sync') {
      if (!idValid(p.id) || !['synced', 'retry', 'needs_contact_resolution'].includes(p.state) ||
          (p.senderPhone !== undefined && !/^\d{7,15}$/.test(p.senderPhone))) throw Error('Acuse CRM inválido.');
      crmSync.set(p.id, p.state);
      if (p.senderPhone) {
        crmSyncPhones.set(p.id, p.senderPhone);
        const event = incoming.get(p.id);
        if (event) { incoming.set(p.id, { ...event, senderPhone: p.senderPhone }); phoneByChat.set(event.chatId, p.senderPhone); }
      }
    } else if (record.kind === 'attempt') {
      if (!idValid(p.key) || !replyChatPattern.test(p.chatId ?? '')) throw Error('Intento persistido inválido.');
      attempts.set(p.key, { ...p, state: 'needs_review' });
    } else if (record.kind === 'result') {
      const previous = attempts.get(p.key);
      if (!previous || !['blocked', 'accepted', 'needs_review'].includes(p.state)) throw Error('Resultado persistido inválido.');
      attempts.set(p.key, { ...previous, ...p });
      if (p.state === 'accepted' && idValid(p.providerId)) bots.set(p.providerId, p.key);
    } else if (record.kind === 'ack') {
      const previous = attempts.get(p.key);
      if (!previous || !['accepted', 'delivered', 'read', 'failed'].includes(p.state)) throw Error('Acuse persistido inválido.');
      attempts.set(p.key, { ...previous, state: p.state });
    } else if (record.kind === 'manual_attempt') {
      if (!requestIdPattern.test(p.key ?? '') || !manualChatPattern.test(p.chatId ?? '') || !/^[a-f0-9]{64}$/.test(p.bodyHash ?? '')) throw Error('Intento manual inválido.');
      manualAttempts.set(p.key, { ...p, state: 'needs_review' });
    } else if (record.kind === 'manual_result') {
      const previous = manualAttempts.get(p.key);
      if (!previous || !['accepted', 'needs_review'].includes(p.state)) throw Error('Resultado manual inválido.');
      manualAttempts.set(p.key, { ...previous, ...p });
    }
  }
  for (const record of store.records()) apply(record);
  async function persist(kind, payload) { await store.append(kind, payload); apply({ kind, payload }); }
  function enqueue(fn) {
    const operation = tail.then(fn);
    tail = operation.catch(() => { status = 'storage_error'; qr = null; });
    return operation;
  }
  async function syncInbound(event) {
    if (!onInbound || !event || status !== 'ready' || !binding ||
        ['synced', 'needs_contact_resolution'].includes(crmSync.get(event.id))) return;
    if (crmSyncInFlight.has(event.id)) return crmSyncInFlight.get(event.id);
    const task = (async () => {
      let state = 'retry';
      let senderPhone = event.senderPhone ?? crmSyncPhones.get(event.id) ?? (/^(\d{7,15})@c\.us$/.exec(event.chatId)?.[1] ?? null);
      try {
        if (!senderPhone && event.chatId.endsWith('@lid') && typeof resolveSenderPhone === 'function') {
          senderPhone = await resolveSenderPhone(event.chatId);
        }
        if (!/^\d{7,15}$/.test(senderPhone ?? '')) state = 'needs_contact_resolution';
        else {
          const enriched = { ...event, senderPhone };
          incoming.set(event.id, enriched);
          phoneByChat.set(event.chatId, senderPhone);
          const result = await onInbound({ ...enriched, lineKey, linkedPhone: binding });
          if (['synced', 'needs_contact_resolution'].includes(result?.state)) state = result.state;
        }
      } catch { /* A lost response is retried idempotently after the next start. */ }
      try { await enqueue(() => persist('crm_sync', { id: event.id, state, ...(senderPhone ? { senderPhone } : {}) })); }
      catch { /* The inbound remains in the durable local journal for review. */ }
    })();
    crmSyncInFlight.set(event.id, task);
    try { await task; } finally { crmSyncInFlight.delete(event.id); }
  }
  async function retryPendingCrmSync() {
    if (!onInbound || status !== 'ready') return;
    for (const event of incoming.values()) {
      if (crmSync.get(event.id) === 'retry') await syncInbound(event);
    }
  }
  function scheduleCrmSync(event) {
    const task = crmSyncTail.then(async () => {
      await syncInbound(event);
      await retryPendingCrmSync();
    });
    crmSyncTail = task.catch(() => {});
    return task;
  }
  function confirmConnection() {
    return enqueue(async () => {
      if (!readySignalSeen || stopping || ['wrong_number', 'storage_error', 'auth_failure'].includes(status)) return;
      try { socketState = await client.getState(); } catch { socketState = null; return; }
      if (socketState !== 'CONNECTED') {
        if (status === 'ready') { status = 'disconnected'; qr = null; }
        return;
      }
      const phone = client.info?.wid?.user;
      if (!/^\d{7,15}$/.test(phone ?? '') || (binding && binding !== phone) || (expectedPhone && expectedPhone !== phone)) {
        status = 'wrong_number'; qr = null; await client.destroy(); return;
      }
      if (!binding) await persist('binding', { phone });
      status = 'ready'; connectionReason = null; qr = null;
    });
  }
  const handlers = {
    qr(value) {
      if (!stopping && ['connecting', 'awaiting_qr'].includes(status) && typeof value === 'string' && value.length <= 16384) {
        status = 'awaiting_qr'; qr = { value, at: now() };
      }
    },
    ready() {
      readySignalSeen = true;
      void confirmConnection().then(() => retryPendingCrmSync()).catch(() => {});
    },
    auth_failure() { if (!stopping) { status = 'auth_failure'; qr = null; } },
    session_error() { if (!stopping) { status = 'connection_error'; connectionReason = 'navigation_interrupted'; qr = null; } },
    disconnected() { if (!['wrong_number', 'storage_error'].includes(status)) status = 'disconnected'; qr = null; },
    message_create(message) {
      if (status !== 'ready' || stopping) return;
      const event = snapshot(message, now());
      if (!event || event.chatId === `${binding}@c.us`) return;
      // Group messages are available for an explicit human send only; they
      // never enter customer automation or the one-to-one CRM journal.
      if (event.chatId.endsWith('@g.us') && !event.own) return;
      // Block a newly observed human action immediately, before async persistence.
      if (event.own && !bots.has(event.id)) pendingHuman.set(event.id, event.chatId);
      void enqueue(async () => {
        if (stopping || status === 'storage_error') return;
        if (bots.has(event.id)) { pendingHuman.delete(event.id); return null; }
        if (seen.has(event.id)) return null;
        let stored=event;
        if (!event.own) {
          let senderPhone=/^(\d{7,15})@c\.us$/.exec(event.chatId)?.[1] ?? null;
          if (!senderPhone && event.chatId.endsWith('@lid') && typeof resolveSenderPhone === 'function') {
            try { senderPhone=await resolveSenderPhone(event.chatId); } catch { /* CRM sync retries this lookup from the journal. */ }
          }
          if (/^\d{7,15}$/.test(senderPhone ?? '')) stored={...event,senderPhone};
        }
        await persist(event.own ? 'human' : 'inbound', stored);
        return event.own ? null : stored;
      }).then(saved => {
        if (saved) void scheduleCrmSync(saved);
      }).catch(() => {});
    },
    message(message) { handlers.message_create(message); },
    message_ack(message, ack) {
      const providerId = message?.id?._serialized;
      void enqueue(async () => {
        const key = bots.get(providerId), attempt = attempts.get(key);
        if (!attempt || stopping) return;
        const state = ({ '-1': 'failed', 0: 'accepted', 1: 'accepted', 2: 'delivered', 3: 'read', 4: 'read' })[ack];
        const rank = { needs_review: 0, accepted: 1, failed: 1, delivered: 2, read: 3 };
        if (!state || rank[state] < rank[attempt.state] || state === attempt.state) return;
        await persist('ack', { key, state });
      }).catch(() => {});
    },
  };
  for (const [event, handler] of Object.entries(handlers)) client.on(event, handler);
  function blocked(chatId) {
    const target=canonicalChatId(chatId);
    return status !== 'ready' || client.info?.wid?.user !== binding || stopping ||
      [...paused].some(value=>canonicalChatId(value)===target) || [...pendingHuman.values()].some(value=>canonicalChatId(value)===target);
  }
  async function permitted(job) {
    if (blocked(job.chatId) || !authorizeReply) return false;
    try {
      const p = await authorizeReply({ ...job, sessionPhone: binding, bodyHash: replyBodyHash(job.body) });
      return !blocked(job.chatId) && p?.allowed === true && p.paused === false && p.permissionConfirmed === true &&
        p.accountId === accountId && p.lineKey === lineKey && p.sessionPhone === binding &&
        p.inboundId === job.inboundId && p.chatId === job.chatId && p.bodyHash === replyBodyHash(job.body) &&
        Number.isFinite(p.expiresAt) && p.expiresAt > now() && p.expiresAt <= now() + 30_000;
    } catch { return false; }
  }
  return Object.freeze({
    async start() {
      if (!enabled) return 'disabled';
      if (started || stopping) return status;
      started = true; status = 'connecting';
      let startupTimer;
      try {
        await Promise.race([client.initialize(), new Promise((_, reject) => {
          startupTimer = setTimeout(() => reject(Error('Startup timeout')), startupTimeoutMs);
        })]);
      } catch (error) {
        if (!stopping && status !== 'wrong_number') {
          status = 'connection_error'; qr = null;
          const message = typeof error === 'string' ? error : error?.message ?? '';
          connectionReason = /context was destroyed|Cannot find context/i.test(message) ? 'navigation_interrupted' :
            /timeout|timed out/i.test(message) ? 'timeout' : 'initialization_failed';
          try { await client.destroy(); } catch { /* Keep the failure visible without disclosing browser details. */ }
        }
      } finally { clearTimeout(startupTimer); }
      return status;
    },
    status() {
      return { status, socketState, connectionReason, accountId, lineKey, linkedPhone: binding, repliesEnabled: repliesEnabled && !!authorizeReply,
        received: incoming.size, pausedChats: paused.size, attempts: attempts.size,
        centralSync: { synced: [...crmSync.values()].filter(state => state === 'synced').length,
          retry: [...crmSync.values()].filter(state => state === 'retry').length,
          needsContactResolution: [...crmSync.values()].filter(state => state === 'needs_contact_resolution').length },
        recent: [...incoming.values()].slice(-10).map(p => ({ id: p.id, chatId: p.chatId, text: p.text, type: p.type, timestamp: p.timestamp })) };
    },
    qr() { return status === 'awaiting_qr' && qr && now() - qr.at < 60_000 ? qr.value : null; },
    refreshConnection() { return confirmConnection(); },
    async syncPending() { await crmSyncTail; await retryPendingCrmSync(); await crmSyncTail; },
    async idle() { await tail; await Promise.resolve(); await crmSyncTail; },
    sendManual(input) {
      const job = input && { requestId: input.requestId, chatId: input.chatId, body: input.body, authorizeTarget: input.authorizeTarget };
      if (!job || !requestIdPattern.test(job.requestId ?? '') || !manualChatPattern.test(job.chatId ?? '') ||
          typeof job.body !== 'string' || !job.body.trim() || job.body.length > 4000 || typeof job.authorizeTarget !== 'function') {
        return Promise.reject(Error('Mensaje manual inválido.'));
      }
      const bodyHash = replyBodyHash(job.body);
      const previous = manualAttempts.get(job.requestId);
      if (previous) {
        if (previous.chatId !== job.chatId || previous.bodyHash !== bodyHash) return Promise.resolve({ state: 'request_conflict' });
        return Promise.resolve({ state: 'already_attempted', previous: previous.state, providerId: previous.providerId ?? null });
      }
      if (status !== 'ready' || client.info?.wid?.user !== binding || stopping) return Promise.resolve({ state: 'disabled' });
      const pendingKey = `manual:${job.requestId}`;
      pendingHuman.set(pendingKey, job.chatId);
      return (async () => {
        try {
          // Target validation can refresh connection state, which itself uses
          // the adapter queue. Keep it outside that queue to avoid waiting on
          // a task that is queued behind itself.
          let allowed = false;
          try { allowed = await job.authorizeTarget(job.chatId) === true; } catch { allowed = false; }
          if (!allowed) return { state: 'blocked' };
          return await enqueue(async () => {
          if (manualAttempts.has(job.requestId)) { const prior=manualAttempts.get(job.requestId); return { state: 'already_attempted', previous: prior.state, providerId: prior.providerId ?? null }; }
          if (status !== 'ready' || client.info?.wid?.user !== binding || stopping) return { state: 'disabled' };
          if (status !== 'ready' || client.info?.wid?.user !== binding || stopping) return { state: 'blocked' };
          await persist('manual_attempt', { key: job.requestId, chatId: job.chatId, bodyHash });
          // Pause automation immediately after an explicit human send request.
          await persist('human', { id: pendingKey, chatId: job.chatId, text: job.body });
          let state = 'needs_review', providerId = null;
          try {
            const message = await client.sendMessage(job.chatId, job.body, { sendSeen: false });
            if (idValid(message?.id?._serialized) && (message.fromMe === true || message.id.fromMe === true) && message.to === job.chatId) {
              providerId = message.id._serialized;
              state = 'accepted';
            }
          } catch { /* A manual send with an unknown outcome is never replayed. */ }
          await persist('manual_result', { key: job.requestId, state, providerId });
          return { state, providerId };
          });
        } finally { pendingHuman.delete(pendingKey); }
      })();
    },
    dispatch(input) {
      const job = structuredClone(input);
      if (!job || job.accountId !== accountId || job.lineKey !== lineKey || !idValid(job.key) || job.key.length > 160 ||
          !replyChatPattern.test(job.chatId ?? '') || !idValid(job.inboundId) || typeof job.body !== 'string' || !job.body.trim() || job.body.length > 4000) {
        return Promise.reject(Error('Respuesta fuera de la sesión o inválida.'));
      }
      return enqueue(async () => {
        if (!repliesEnabled) return { state: 'disabled' };
        if (attempts.has(job.key)) return { state: 'already_attempted', previous: attempts.get(job.key).state };
        const inbound=incoming.get(job.inboundId);
        if (!inbound || canonicalChatId(inbound.chatId)!==canonicalChatId(job.chatId) || !await permitted(job)) return { state: 'blocked' };
        await persist('attempt', { key: job.key, chatId: job.chatId, inboundId: job.inboundId, bodyHash: replyBodyHash(job.body) });
        if (!await permitted(job)) { await persist('result', { key: job.key, state: 'blocked' }); return { state: 'blocked' }; }
        let state = 'needs_review', providerId = null;
        try {
          const message = await client.sendMessage(job.chatId, job.body, { sendSeen: false });
          if (idValid(message?.id?._serialized) && (message.fromMe === true || message.id.fromMe === true) && message.to === job.chatId) {
            providerId = message.id._serialized; state = 'accepted';
          }
        } catch { /* Unknown outcome stays reserved; never resend automatically. */ }
        await persist('result', { key: job.key, state, providerId });
        return { state, providerId };
      });
    },
    async stop() {
      stopping = true; qr = null;
      for (const [event, handler] of Object.entries(handlers)) client.removeListener(event, handler);
      await tail;
      try { if (started) await client.destroy(); }
      finally { await store.close(); status = 'stopped'; }
    },
  });
}
