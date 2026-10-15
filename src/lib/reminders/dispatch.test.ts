import { describe, expect, it } from 'vitest';
import { isWithinWhatsAppReplyWindow } from './dispatch';

describe('WhatsApp scheduled message window', () => {
  const now = Date.parse('2026-10-14T10:00:00.000Z');

  it('allows a recent customer reply', () => {
    expect(isWithinWhatsAppReplyWindow('2026-10-14T09:00:00.000Z', now)).toBe(true);
  });

  it('blocks a missing, expired or near-expired reply', () => {
    expect(isWithinWhatsAppReplyWindow(null, now)).toBe(false);
    expect(isWithinWhatsAppReplyWindow('2026-10-13T09:59:00.000Z', now)).toBe(false);
    expect(isWithinWhatsAppReplyWindow('2026-10-13T10:00:00.000Z', now)).toBe(false);
  });

  it('does not accept future or invalid timestamps', () => {
    expect(isWithinWhatsAppReplyWindow('invalid', now)).toBe(false);
    expect(isWithinWhatsAppReplyWindow('2026-10-14T10:01:00.000Z', now)).toBe(false);
  });
});
