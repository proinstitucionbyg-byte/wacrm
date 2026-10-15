import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('enrollment welcome card regression', () => {
  it('does not poll and append duplicate cards while a chat stays open', () => {
    const source = readFileSync(
      new URL('./enrollment-welcome-check.tsx', import.meta.url),
      'utf8'
    );
    expect(source).not.toMatch(/setInterval\s*\(/);
    expect(source).toContain('data-enrollment-welcome-slot');
  });
});
