import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// These jobs run inside the deployed container, independently of a browser or laptop.
export async function sweep(
  path,
  { secret, port, fetcher = fetch, log = console }
) {
  try {
    const response = await fetcher(`http://127.0.0.1:${port}${path}`, {
      headers: { 'x-cron-secret': secret },
      signal: AbortSignal.timeout(120_000),
    });
    // Do not print bodies, URLs with credentials, or the shared secret.
    if (!response.ok) log.error(`[scheduler] ${path}: HTTP ${response.status}`);
    else log.info(`[scheduler] ${path}: OK`);
    await response.body?.cancel();
    return response.ok;
  } catch {
    log.error(`[scheduler] ${path}: unavailable; retry on next cycle`);
    return false;
  }
}

export function startServer() {
  const server = spawn(process.execPath, ['server.js'], {
    stdio: 'inherit',
    env: process.env,
  });
  const timers = new Set();
  let stopping = false;
  const secret = process.env.AUTOMATION_CRON_SECRET;
  const port = process.env.PORT || '3000';
  const schedule = (path, delay) => {
    const timer = setTimeout(async () => {
      timers.delete(timer);
      if (stopping) return;
      await sweep(path, { secret, port });
      if (!stopping) schedule(path, 60_000);
    }, delay);
    timers.add(timer);
  };
  if (secret) {
    schedule('/api/automations/cron', 15_000);
    schedule('/api/flows/cron', 20_000);
    console.info(
      '[scheduler] enabled: automations and flows, every minute after each completed cycle'
    );
  } else
    console.error('[scheduler] disabled: AUTOMATION_CRON_SECRET is missing');
  const stop = (signal) => {
    stopping = true;
    for (const timer of timers) clearTimeout(timer);
    server.kill(signal);
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
  server.on('error', () => {
    console.error('[server] failed to start');
    stop('SIGTERM');
    process.exit(1);
  });
  server.on('exit', (code, signal) => {
    stopping = true;
    for (const timer of timers) clearTimeout(timer);
    process.exit(signal ? 1 : (code ?? 1));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  startServer();
