// Explicit local SMS transport. Importing this module never starts a worker.
import { createHash } from 'node:crypto';
import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createSmsGateReader, localBase } from './smsgate-reader.mjs';

// Atomic on one shared filesystem. Multi-laptop dispatch also requires the
// server-side claim; independent copies of this journal are NOT a global lock.
export function fileDispatchJournal(directory) {
  const path = key => join(directory, createHash('sha256').update(key).digest('hex') + '.json');
  return {
    async reserve(key, record) {
      await mkdir(directory, { recursive: true });
      let file;
      try { file = await open(path(key), 'wx', 0o600); }
      catch (error) { if (error.code === 'EEXIST') return false; throw error; }
      try { await file.writeFile(JSON.stringify(record)); await file.sync(); }
      finally { await file.close(); }
      return true;
    },
    async read(key) { return JSON.parse(await readFile(path(key), 'utf8')); },
    async update(key, record) { await writeFile(path(key), JSON.stringify(record), { mode: 0o600 }); },
  };
}

export function createSmsGateTransport(config, { journal, fetchImpl = fetch, now = Date.now } = {}) {
  const reader = createSmsGateReader(config, { fetchImpl });
  const base = localBase(config.baseUrl);
  const deviceKey = config.deviceKey;
  if (!journal?.reserve || !journal?.read || !journal?.update) throw Error('Falta registro persistente de envios.');
  const authorization = 'Basic ' + Buffer.from(`${config.username}:${config.password}`).toString('base64');
  function identity(job) {
    if (!job || typeof job.key !== 'string' || !job.key.trim() || job.key.length > 160) throw Error('Trabajo invalido.');
    // Same campaign key stays reserved even if a different device is chosen.
    return 'wcm-' + createHash('sha256').update(job.key).digest('hex');
  }
  function classify(data, id) {
    if (data?.id !== id) return 'needs_review';
    return ({ Pending: 'accepted', Processed: 'accepted', Sent: 'sent',
      Delivered: 'delivered', Failed: 'failed' })[data.state] ?? 'needs_review';
  }
  return Object.freeze({
    deviceKey,
    async dispatch(job, eligibility) {
      const id = identity(job);
      if (config.enabled !== true || config.simReady !== true ||
        eligibility?.allowed !== true || eligibility?.paused !== false ||
        eligibility?.permissionConfirmed !== true ||
        (job.purpose === 'collection' && eligibility?.paymentStatus !== 'pending')) {
        return { id, state: 'blocked' };
      }
      if (!['collection', 'support', 'notice'].includes(job.purpose) ||
        !/^\+[1-9]\d{7,14}$/.test(job.recipient ?? '') ||
        typeof job.body !== 'string' || !job.body.trim() || job.body.length > 4000 ||
        !Number.isFinite(Date.parse(job.runAt)) || !Number.isFinite(Date.parse(job.expiresAt))) {
        throw Error('Datos de envio invalidos.');
      }
      const timestamp = now(), expiry = Date.parse(job.expiresAt);
      if (timestamp < Date.parse(job.runAt)) return { id, state: 'not_due' };
      if (expiry - timestamp < 1000) return { id, state: 'expired' };
      const record = { id, deviceKey, state: 'needs_review', attemptedAt: new Date(timestamp).toISOString() };
      if (!await journal.reserve(job.key, record)) return { id, state: 'already_attempted' };
      let state = 'needs_review';
      try {
        const response = await fetchImpl(new URL('/message', base), {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
          headers: { 'Content-Type': 'application/json', Authorization: authorization },
          body: JSON.stringify({ id, textMessage: { text: job.body }, phoneNumbers: [job.recipient],
            ttl: Math.min(86400, Math.floor((expiry - timestamp) / 1000)), withDeliveryReport: true }),
        });
        // An HTTP acknowledgement never proves transmission or delivery.
        if (response.status === 202) {
          const data = await response.json();
          if (data?.id === id) state = 'accepted';
        } else await response.body?.cancel();
      } catch { /* Timeout is uncertain: retain reservation, never retry POST. */ }
      try { await journal.update(job.key, { ...record, state }); }
      catch { return { id, state: 'needs_review' }; }
      return { id, state };
    },
    async reconcile(key, centralEvidence) {
      let record, centralOnly = false;
      try { record = await journal.read(key); }
      catch {
        // Another authorized laptop may have no local journal. An authenticated
        // central attempt ID permits GET only, never construction of another POST.
        const expected = identity({ key });
        if (centralEvidence?.providerId !== expected || centralEvidence?.deviceKey !== deviceKey) {
          throw Error('Falta evidencia del intento central.');
        }
        record = { id: expected, deviceKey }; centralOnly = true;
      }
      if (record.deviceKey !== deviceKey || record.id !== identity({ key })) throw Error('El intento pertenece a otra linea.');
      let state;
      try { state = classify(await reader.messageStatus(record.id), record.id); }
      catch { return { id: record.id, state: 'needs_review' }; }
      if (!centralOnly) await journal.update(key, { ...record, state, checkedAt: new Date(now()).toISOString() });
      return { id: record.id, state };
    },
  });
}
