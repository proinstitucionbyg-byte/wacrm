import { describe, expect, it, vi } from 'vitest';
import { sweep } from '../../../scripts/server-entrypoint.mjs';
describe('container scheduler', () => {
  it('calls only the local server with the existing secret header', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}'));
    const log = { ...console, info: vi.fn(), error: vi.fn() };
    expect(
      await sweep('/api/automations/cron', {
        secret: 'private',
        port: '80',
        fetcher,
        log,
      })
    ).toBe(true);
    expect(fetcher).toHaveBeenCalledWith(
      'http://127.0.0.1:80/api/automations/cron',
      expect.objectContaining({ headers: { 'x-cron-secret': 'private' } })
    );
    expect(JSON.stringify(log.info.mock.calls)).not.toContain('private');
  });
  it('reports failures without leaking credentials or stopping future cycles', async () => {
    const log = { ...console, info: vi.fn(), error: vi.fn() };
    expect(
      await sweep('/api/flows/cron', {
        secret: 'private',
        port: '80',
        fetcher: vi.fn().mockRejectedValue(new Error('private')),
        log,
      })
    ).toBe(false);
    expect(JSON.stringify(log.error.mock.calls)).not.toContain('private');
  });
});
