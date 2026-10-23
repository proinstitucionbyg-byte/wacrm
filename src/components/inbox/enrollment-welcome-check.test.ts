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

  it('keeps the missing-field snapshot visible and restores an unsaved draft', () => {
    const source = readFileSync(
      new URL('./enrollment-welcome-check.tsx', import.meta.url),
      'utf8'
    );
    expect(source).toContain('visibleIntakeFields(intakeFields)');
    expect(source).toContain('window.sessionStorage.setItem');
    expect(source).toContain('readIntakeEditorDraft(');
    expect(source).toContain('Verificado en chat');
    expect(source).toContain('rebaseIntakeEditorData');
    expect(source).toContain('max-w-2xl');
  });
});
