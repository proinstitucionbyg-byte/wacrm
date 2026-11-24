import { afterEach, expect, it, vi } from 'vitest';
import { readGroupCommand } from './group-command-client';
const id = '11111111-1111-4111-8111-111111111111';
const result = { kind: 'list', total: 0, offset: 0, groups: [] };
const mock = (command: unknown) =>
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ command })));
afterEach(() => vi.unstubAllGlobals());
it('reads the existing command until the real queue status is done', async () => {
  mock({ id, status: 'running' });
  expect(await readGroupCommand(id, new AbortController().signal)).toBeNull();
  mock({ id, status: 'done', result_data: result });
  expect(await readGroupCommand(id, new AbortController().signal)).toEqual(
    result
  );
  expect(fetch).toHaveBeenCalledWith(
    expect.stringContaining(id),
    expect.objectContaining({ cache: 'no-store' })
  );
});
it('never treats a review result or missing data as success', async () => {
  mock({ id, status: 'needs_review', result: 'Revisa el grupo' });
  await expect(
    readGroupCommand(id, new AbortController().signal)
  ).rejects.toThrow('Revisa el grupo');
  mock({ id, status: 'done' });
  await expect(
    readGroupCommand(id, new AbortController().signal)
  ).rejects.toThrow('Falta confirmar');
});
it('rejects results for another command and unexpected message content', async () => {
  mock({
    id: '22222222-2222-4222-8222-222222222222',
    status: 'done',
    result_data: result,
  });
  await expect(
    readGroupCommand(id, new AbortController().signal)
  ).rejects.toThrow('no corresponde');
  mock({
    id,
    status: 'done',
    result_data: { ...result, messages: ['secret'] },
  });
  await expect(
    readGroupCommand(id, new AbortController().signal)
  ).rejects.toThrow();
});
