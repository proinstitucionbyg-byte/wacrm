import { describe, expect, it } from 'vitest';
import { manualDocumentDelivery } from './manual-document-delivery';
const folder = 'https://drive.google.com/drive/folders/student';
const receipt = { sent: true, sent_at: '2026-10-28T06:00:00Z',
  sent_by: '11111111-1111-4111-8111-111111111111', folder_url: folder, history: [{ sent: true }] };
describe('human document delivery declaration', () => {
  it('keeps the declaration separate from provider evidence and excludes history', () => {
    expect(manualDocumentDelivery(receipt, folder)).toEqual({ sent: true,
      sent_at: receipt.sent_at, sent_by: receipt.sent_by });
  });
  it.each([null, {}, { ...receipt, sent: false }, { ...receipt, sent_by: 'forged' },
    { ...receipt, sent_at: 'invalid' }, { ...receipt, folder_url: `${folder}-old` }])(
    'rejects missing, revoked or obsolete evidence', value => {
      expect(manualDocumentDelivery(value, folder).sent).toBe(false);
    });
});
