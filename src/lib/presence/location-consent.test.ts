import { describe, expect, it } from 'vitest';
import { locationConsentKey, locationDeclinedKey } from './location-consent';

describe('location preferences', () => {
  it('keeps decisions separate for two advisers on the same browser', () => {
    expect(locationConsentKey('adviser-a')).not.toBe(locationConsentKey('adviser-b'));
    expect(locationDeclinedKey('adviser-a')).not.toBe(locationDeclinedKey('adviser-b'));
    expect(locationConsentKey('adviser-a')).not.toBe(locationDeclinedKey('adviser-a'));
  });
});
