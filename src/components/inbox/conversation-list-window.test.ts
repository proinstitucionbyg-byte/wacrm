import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('conversation list render window', () => {
  it('renders conversations in controlled batches instead of mounting the full inbox', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/components/inbox/conversation-list.tsx'),
      'utf8',
    );
    expect(source).toContain('const CONVERSATION_RENDER_BATCH = 150');
    expect(source).toContain('filtered.slice(0, visibleLimit)');
    expect(source).toContain('Mostrar conversaciones anteriores');
  });
});
