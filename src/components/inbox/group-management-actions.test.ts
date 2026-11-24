import { expect, it, vi } from 'vitest';
vi.mock('@/lib/storage/upload-media', () => ({
  uploadAccountMedia: vi.fn(),
  MEDIA_MAX_BYTES_BY_KIND: { image: 5242880 },
}));
import { groupParticipantPhones } from './group-management-actions';
it('normalizes the supported Peru formats and removes duplicate additions', () => {
  expect(
    groupParticipantPhones('937 467 119\n+51 937467119\n51937467119')
  ).toEqual(['51937467119@c.us']);
});
it('refuses an ambiguous, empty or oversized list instead of guessing a member', () => {
  expect(() => groupParticipantPhones('Luis')).toThrow('Revisa');
  expect(() => groupParticipantPhones('')).toThrow('entre 1 y 50');
  expect(() =>
    groupParticipantPhones(Array(51).fill('937467119').join('\n'))
  ).toThrow('entre 1 y 50');
});
