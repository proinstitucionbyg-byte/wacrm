// Read-only local transport. Does not enable the simulation queue or send messages.
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

export function localBase(value) {
  try {
    const url = new URL(value);
    const octets = url.hostname.split('.').map(Number);
    const privateV4 = isIP(url.hostname) === 4 && (
      octets[0] === 10 || octets[0] === 127 ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168)
    );
    if (!['http:', 'https:'].includes(url.protocol) ||
      !(privateV4 || url.hostname === 'localhost') || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash) throw new Error();
    return url;
  } catch { throw new Error('Configuracion local SMSGate invalida.'); }
}

function normalizePhone(value, countryDial) {
  if (typeof value !== 'string' || /[^\d+()\s.-]/.test(value)) return null;
  let digits = value.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  else if (!value.trim().startsWith('+') && digits.length === 9) digits = countryDial + digits;
  return /^[1-9]\d{7,14}$/.test(digits) ? '+' + digits : null;
}

export function createSmsGateReader(config, { fetchImpl = fetch } = {}) {
  const base = localBase(config.baseUrl);
  if (typeof config.username !== 'string' || !config.username ||
    typeof config.password !== 'string' || !config.password ||
    typeof config.deviceKey !== 'string' || !config.deviceKey || config.deviceKey.length > 160) {
    throw new Error('Configuracion de acceso SMSGate incompleta.');
  }
  const deviceKey = config.deviceKey;
  const countryDial = config.countryDial ?? '51';
  if (!/^[1-9]\d{0,2}$/.test(countryDial)) throw new Error('Configuracion de pais invalida.');
  const authorization = 'Basic ' + Buffer.from(`${config.username}:${config.password}`).toString('base64');

  async function get(path, parameters = {}) {
    const url = new URL(path, base);
    for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, String(value));
    let response;
    try {
      response = await fetchImpl(url, {
        method: 'GET', redirect: 'error', signal: AbortSignal.timeout(10000),
        headers: { Accept: 'application/json', Authorization: authorization },
      });
    } catch { throw new Error('No se pudo consultar SMSGate; no se enviaron mensajes.'); }
    if (!response.ok) {
      // Do not print provider bodies, credentials, URLs or arbitrary network errors.
      await response.body?.cancel();
      const error = new Error(`La lectura SMSGate devolvio HTTP ${response.status}.`);
      error.status = response.status;
      throw error;
    }
    try { return { data: await response.json(), headers: response.headers }; }
    catch { throw new Error('SMSGate devolvio una respuesta de lectura invalida.'); }
  }

  return Object.freeze({
    async health() { return (await get('/health')).data; },
    async messageStatus(id) {
      if (typeof id !== 'string' || !/^[A-Za-z0-9:_-]{1,160}$/.test(id)) {
        throw new Error('Identificador de mensaje invalido.');
      }
      return (await get('/message/' + encodeURIComponent(id))).data;
    },
    async replies({ from, to, allowedSenders, limit = 50, offset = 0 } = {}) {
      if (typeof from !== 'string' || typeof to !== 'string' ||
        !Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(to)) ||
        Date.parse(from) > Date.parse(to)) throw new Error('Indica fechas de lectura validas.');
      if (!Number.isInteger(limit) || limit < 1 || limit > 500 ||
        !Number.isInteger(offset) || offset < 0) throw new Error('Limites de pagina invalidos.');
      if (!Array.isArray(allowedSenders) || !allowedSenders.length) {
        throw new Error('Indica los remitentes autorizados para esta lectura.');
      }
      const senders = new Set(allowedSenders.map(value => normalizePhone(value, countryDial)));
      if (senders.has(null)) throw new Error('Lista de remitentes invalida.');
      // The API otherwise uses the phone clock as upper bound; require explicit dates.
      // Do not filter type=SMS: text replies may arrive as MMS_DOWNLOADED.
      const { data, headers } = await get('/inbox', {
        from, to, limit, offset, includeAttachments: false,
      });
      if (!Array.isArray(data) || data.length > limit) throw new Error('Pagina de entrada invalida.');
      const seen = new Set(), messages = [];
      for (const row of data) {
        if (!row || !['SMS', 'MMS_DOWNLOADED'].includes(row.type) ||
          typeof row.id !== 'string' || !row.id ||
          typeof row.contentPreview !== 'string' ||
          typeof row.createdAt !== 'string' || !Number.isFinite(Date.parse(row.createdAt))) continue;
        const sender = normalizePhone(row.sender, countryDial);
        if (!senders.has(sender)) continue;
        const key = createHash('sha256').update(JSON.stringify([
          deviceKey, row.type, row.id, sender, row.createdAt,
        ])).digest('hex');
        if (seen.has(key)) continue;
        seen.add(key);
        messages.push({ key, id: row.id, type: row.type, sender,
          text: row.contentPreview, createdAt: row.createdAt });
      }
      const rawTotal = headers.get('X-Total-Count');
      const total = rawTotal !== null && /^\d+$/.test(rawTotal) ? Number(rawTotal) : null;
      const nextOffset = data.length && (total === null ? data.length === limit : offset + data.length < total)
        ? offset + data.length : null;
      return { messages, fetched: data.length, total, nextOffset };
    },
  });
}
