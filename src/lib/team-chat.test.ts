import { describe, expect, it } from 'vitest';
import {
  parseTeamMessage,
  parseTeamThread,
  teamThreadTitle,
} from './team-chat';
const id = '11111111-1111-4111-8111-111111111111',
  other = '22222222-2222-4222-8222-222222222222';
describe('internal team chat input', () => {
  it('preserves paragraphs, indentation and line breaks', () => {
    expect(
      parseTeamMessage({ id, body: 'Hola\r\n\r\n  Segunda linea' })
    ).toEqual({ id, body: 'Hola\n\n  Segunda linea' });
  });
  it('rejects empty, oversized and malformed messages', () => {
    expect(parseTeamMessage({ id, body: '  ' })).toBeNull();
    expect(parseTeamMessage({ id, body: 'a'.repeat(4001) })).toBeNull();
    expect(parseTeamMessage({ id: 'bad', body: 'hola' })).toBeNull();
  });
  it('requires an explicit name for a group and deduplicates participants', () => {
    expect(parseTeamThread({ members: [id, other] })).toBeNull();
    expect(parseTeamThread({ members: [id, id] })).toEqual({
      members: [id],
      title: null,
    });
    expect(
      parseTeamThread({ members: [id, other], title: ' FIDELIZACION  TURNO ' })
    ).toEqual({ members: [id, other], title: 'FIDELIZACION TURNO' });
  });
  it('uses the other teammate name for a direct chat', () => {
    expect(
      teamThreadTitle(
        {
          id,
          kind: 'direct',
          title: null,
          last_message_at: '',
          unread: 0,
          team_thread_members: [
            { user_id: id, last_read_at: null },
            { user_id: other, last_read_at: null },
          ],
        },
        [{ user_id: other, full_name: 'Ashley', account_role: 'agent' }],
        id
      )
    ).toBe('Ashley');
  });
});
