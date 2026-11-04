// Transport orchestration only: no CLI, credentials, HTTP endpoint or auto-start.
// The existing server queue is SIMULATION ONLY and cannot supply these jobs.
// A production queue adapter and authoritative eligibility reader are still needed.
import { createHash } from 'node:crypto';

const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const providerStates = new Set(['accepted', 'sent', 'delivered', 'failed', 'needs_review']);
const providerId = key => 'wcm-' + createHash('sha256').update(key).digest('hex');

export function createSmsGateQueueBridge({ enabled = false, accountId, workerId, lineKey, deviceKey,
  queue, transport, revalidate, now = Date.now } = {}) {
  if (!uuid(accountId) || !uuid(workerId) || !/^SMS-[A-Za-z0-9_-]{1,60}$/.test(lineKey ?? '') ||
    typeof deviceKey !== 'string' || !deviceKey || transport?.deviceKey !== deviceKey ||
    typeof queue?.claim !== 'function' || typeof queue?.start !== 'function' ||
    typeof queue?.recordResult !== 'function' || typeof transport?.dispatch !== 'function' ||
    typeof transport?.reconcile !== 'function' || typeof revalidate !== 'function') {
    throw Error('Falta configurar la reserva SMS, su dispositivo y la revalidación del servidor.');
  }
  let busy = false;
  function valid(job) {
    return job?.mode === 'sms_live' && job.channel === 'sms' &&
      job.account_id === accountId && job.worker_id === workerId && job.line_key === lineKey &&
      uuid(job.id) && uuid(job.claim_token) &&
      typeof job.dedup_key === 'string' && job.dedup_key.trim() && job.dedup_key.length <= 160 &&
      ['notice', 'support', 'collection'].includes(job.purpose) &&
      /^\+[1-9]\d{7,14}$/.test(job.recipient ?? '') &&
      typeof job.body === 'string' && job.body.trim() && job.body.length <= 4000 &&
      Number.isFinite(Date.parse(job.run_at)) && Number.isFinite(Date.parse(job.expires_at)) &&
      Date.parse(job.expires_at) > Date.parse(job.run_at) &&
      Date.parse(job.lease_until) > now();
  }
  function fingerprint(job) {
    return JSON.stringify(['id','mode','channel','account_id','worker_id','line_key','claim_token',
      'dedup_key','purpose','recipient','body','run_at','expires_at'].map(key => job[key]));
  }
  async function permit(job) {
    // Trusted server reader, not fields copied from a pasted sheet or queue row.
    const p = await revalidate(Object.freeze({ ...job }));
    if (!p || p.accountId !== accountId || p.jobId !== job.id || p.lineKey !== lineKey ||
      p.deviceKey !== deviceKey || p.allowed !== true || p.paused !== false ||
      p.permissionConfirmed !== true || p.humanActive !== false || p.lineAvailable !== true ||
      p.deviceReady !== true || !Number.isFinite(Date.parse(p.checkedAt)) ||
      Date.parse(p.checkedAt) > now() || now() - Date.parse(p.checkedAt) > 15000 ||
      (job.purpose === 'collection' && p.paymentStatus !== 'pending')) return null;
    return p;
  }
  async function record(job, result) {
    const expectedId = providerId(job.dedup_key);
    const state = result?.id === expectedId && providerStates.has(result.state) ? result.state : 'needs_review';
    try {
      // The future adapter must commit this atomically against this exact lease.
      const receipt = await queue.recordResult({ job_id: job.id, claim_token: job.claim_token,
        provider_id: expectedId, state, checked_at: new Date(now()).toISOString() });
      if (receipt?.recorded !== true) return 'needs_review';
      return receipt.state === undefined ? state : providerStates.has(receipt.state) ? receipt.state : 'needs_review';
    } catch { return 'needs_review'; }
  }
  async function reconcile(job) {
    let result;
    try { result = await transport.reconcile(job.dedup_key, { providerId: job.provider_id, deviceKey }); }
    catch { result = { id: providerId(job.dedup_key), state: 'needs_review' }; }
    return record(job, result);
  }
  return Object.freeze({
    async runOnce() {
      if (enabled !== true) return 'disabled';
      if (busy) return 'busy';
      busy = true;
      try {
        const claimed = await queue.claim({ account_id: accountId, worker_id: workerId, line_key: lineKey });
        if (!claimed) return 'idle';
        const job = Object.freeze({ ...claimed });
        if (!valid(job)) return 'blocked';
        // Lost start/dispatch reply: GET only, never repeat POST.
        if (job.status === 'dispatching') return await reconcile(job);
        if (job.status !== 'claimed') return 'blocked';
        const firstPermit = await permit(job);
        if (!firstPermit || Date.parse(job.run_at) > now() || Date.parse(job.expires_at) - now() < 1000) return 'blocked';
        const startReply = await queue.start({ job_id: job.id, claim_token: job.claim_token });
        const started = Object.freeze({ ...startReply });
        if (!valid(started) || started.status !== 'dispatching' || fingerprint(started) !== fingerprint(job)) return 'blocked';
        // Recheck after reserve/start, so a payment, human takeover or pause wins.
        const freshPermit = await permit(started);
        if (!freshPermit || !valid(started)) {
          await record(started, { id: providerId(started.dedup_key), state: 'needs_review' });
          return 'blocked';
        }
        let result;
        try {
          result = await transport.dispatch({ key: started.dedup_key, purpose: started.purpose,
            recipient: started.recipient, body: started.body, runAt: started.run_at, expiresAt: started.expires_at }, freshPermit);
        } catch { result = { id: providerId(started.dedup_key), state: 'needs_review' }; }
        if (result?.state === 'already_attempted') return await reconcile(started);
        return await record(started, result);
      } finally { busy = false; }
    },
  });
}
