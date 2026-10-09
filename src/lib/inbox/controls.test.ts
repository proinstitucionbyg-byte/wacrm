import { describe, expect, it } from 'vitest';
import {
  parseInboxTag,
  parseLabelApplication,
  parseTransfer,
} from './controls';
const id = '11111111-1111-4111-8111-111111111111';
const tag = {
  name: ' seguimiento ',
  color: '#10b981',
  kind: 'process',
  audience: { users: [], areas: [], roles: [] },
};
describe('etiquetas y traspasos', () => {
  it('permite estados generales sin conceder acceso', () =>
    expect(parseInboxTag(tag)).toMatchObject({
      kind: 'process',
      name: 'SEGUIMIENTO',
    }));
  it('exige destinatarios para conceder acceso', () =>
    expect(parseInboxTag({ ...tag, kind: 'access' })).toBeNull());
  it('combina personas, areas y coordinadores autorizados', () =>
    expect(
      parseInboxTag({
        ...tag,
        kind: 'access',
        audience: {
          users: [id, id],
          areas: ['ventas'],
          roles: ['coordinator'],
        },
      })?.audience
    ).toEqual({ users: [id], areas: ['VENTAS'], roles: ['coordinator'] }));
  it('no permite crear etiquetas de sistema', () =>
    expect(parseInboxTag({ ...tag, kind: 'system' })).toBeNull());
  it('rechaza miembros y roles inventados', () => {
    expect(
      parseInboxTag({
        ...tag,
        audience: { users: ['bad'], areas: [], roles: [] },
      })
    ).toBeNull();
    expect(
      parseInboxTag({
        ...tag,
        audience: { users: [], areas: [], roles: ['god'] },
      })
    ).toBeNull();
  });
  it('limita el etiquetado masivo a cien chats', () => {
    expect(
      parseLabelApplication({
        conversations: Array(101).fill(id),
        tag: id,
        remove: false,
      })
    ).toBeNull();
    expect(
      parseLabelApplication({ conversations: [id, id], tag: id, remove: false })
        ?.conversations
    ).toEqual([id]);
  });
  it('no confunde retirar con aplicar', () => {
    expect(
      parseLabelApplication({ conversations: [id], tag: id, remove: 'false' })
    ).toBeNull();
  });
  it('requiere una decision expresa sobre el historial', () => {
    expect(parseTransfer({ conversation: id, agent: id })).toBeNull();
    expect(
      parseTransfer({ conversation: id, agent: id, full_history: false })
    ).toMatchObject({ full_history: false });
  });
  it('permite retirar asignacion sin inventar destinatario', () =>
    expect(
      parseTransfer({ conversation: id, agent: null, full_history: true })
        ?.agent
    ).toBeNull());
});
