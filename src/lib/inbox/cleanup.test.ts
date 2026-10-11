import {describe,expect,it} from 'vitest';
import {isVisibleInInbox} from './cleanup';
describe('cleared inbox history',()=>{
 it('keeps existing chats unchanged',()=>expect(isVisibleInInbox({last_message_at:null})).toBe(true));
 it('hides cleared chats even without any messages',()=>expect(isVisibleInInbox({inbox_cleared_at:'2026-10-11T10:00:00Z',last_message_at:null})).toBe(false));
 it('does not reopen on an older or equal message',()=>{
  expect(isVisibleInInbox({inbox_cleared_at:'2026-10-11T10:00:00Z',last_message_at:'2026-10-11T09:00:00Z'})).toBe(false);
  expect(isVisibleInInbox({inbox_cleared_at:'2026-10-11T10:00:00Z',last_message_at:'2026-10-11T10:00:00Z'})).toBe(false);
 });
 it('reopens after a new message',()=>expect(isVisibleInInbox({inbox_cleared_at:'2026-10-11T10:00:00Z',last_message_at:'2026-10-11T10:00:01Z'})).toBe(true));
});
