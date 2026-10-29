import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

const kinds = new Set(['binding', 'inbound', 'human', 'crm_sync', 'attempt', 'result', 'ack', 'manual_attempt', 'manual_result']);
export function sessionScope(accountId, lineKey) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(accountId ?? '') ||
      !/^WA-[A-Za-z0-9_-]{1,60}$/.test(lineKey ?? '')) throw Error('Cuenta o línea de WhatsApp inválida.');
  return createHash('sha256').update(`${accountId}:${lineKey}`).digest('hex');
}

// One browser/profile per account + line on this filesystem. No distributed lock.
export async function openSessionStore({ baseDir, accountId, lineKey }) {
  if (!isAbsolute(baseDir ?? '')) throw Error('La carpeta de sesión debe ser absoluta.');
  const scope = sessionScope(accountId, lineKey), directory = join(baseDir, scope);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lockPath = join(directory, 'worker.lock'), lockToken = randomUUID();
  let lock;
  try { lock = await open(lockPath, 'wx', 0o600); }
  catch { throw Error('La sesión está bloqueada. Comprueba el ejecutor anterior; no se abrirá otra copia.'); }
  let closed = false, closing = false, broken = false, tail = Promise.resolve(), records = [], authDir;
  async function release() {
    await lock.close();
    if (await readFile(lockPath, 'utf8') === lockToken) await unlink(lockPath);
  }
  try {
    await lock.writeFile(lockToken); await lock.sync();
    let text = '';
    try { text = await readFile(join(directory, 'events.jsonl'), 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (text && !text.endsWith('\n')) throw Error('Historial incompleto; requiere revisión.');
    records = text.split('\n').filter(Boolean).map((line, index) => {
      const row = JSON.parse(line);
      if (row.scope !== scope || row.seq !== index + 1 || !kinds.has(row.kind) ||
          !row.payload || typeof row.payload !== 'object' || Array.isArray(row.payload)) throw Error('Historial inválido.');
      return row;
    });
    // Keep browser paths short on Windows. The full scope remains the owner.
    // Preserve a legacy profile if it already has a verified number binding.
    authDir = records.some(row => row.kind === 'binding') ? join(directory, 'auth') : join(baseDir, 'profiles', scope.slice(0, 24));
    // Once selected, retain the short profile across subsequent starts too.
    const selectedPath = join(directory, 'profile-path.json');
    try {
      const selected = JSON.parse(await readFile(selectedPath, 'utf8'));
      if (selected.scope !== scope || !['short', 'legacy'].includes(selected.layout)) throw Error('Perfil inválido.');
      authDir = selected.layout === 'short' ? join(baseDir, 'profiles', scope.slice(0, 24)) : join(directory, 'auth');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const selected = await open(selectedPath, 'wx', 0o600);
      try { await selected.writeFile(JSON.stringify({ scope, layout: authDir === join(directory, 'auth') ? 'legacy' : 'short' })); await selected.sync(); }
      finally { await selected.close(); }
    }
    await mkdir(authDir, { recursive: true, mode: 0o700 });
    const ownerPath = join(authDir, 'scope.txt');
    try {
      const owner = await open(ownerPath, 'wx', 0o600);
      try { await owner.writeFile(scope); await owner.sync(); } finally { await owner.close(); }
    } catch (error) {
      if (error.code !== 'EEXIST' || await readFile(ownerPath, 'utf8') !== scope) throw error;
    }
  } catch {
    await release();
    throw Error('No se pudo verificar el historial privado. No se sobrescribió ni se reintentará un envío.');
  }
  return Object.freeze({
    scope, authDir,
    records() { return structuredClone(records); },
    append(kind, payload) {
      if (closing) return Promise.reject(Error('Registro de sesión cerrado.'));
      const task = tail.then(async () => {
        if (closed || broken || !kinds.has(kind) || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
          throw Error('Registro de sesión no disponible.');
        }
        const record = { scope, seq: records.length + 1, kind, payload: structuredClone(payload), at: new Date().toISOString() };
        const file = await open(join(directory, 'events.jsonl'), 'a', 0o600);
        try { await file.writeFile(JSON.stringify(record) + '\n'); await file.sync(); }
        finally { await file.close(); }
        records.push(record);
      });
      tail = task.catch(() => { broken = true; });
      return task;
    },
    async close() {
      closing = true;
      await tail;
      if (!closed) { closed = true; await release(); }
    },
  });
}
