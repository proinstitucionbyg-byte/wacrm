import {describe,it,expect} from 'vitest';
import {latestSessionOrigin} from './session-origin';
describe('latest customer transport',()=>{
  const row=(id:string,key:string|null,date='2026-11-04T10:00:00Z')=>({id,sender_type:'customer' as const,created_at:date,whatsapp_session_line_key:key});
  it('recognizes the session line despite a newer outgoing message',()=>{
    expect(latestSessionOrigin([row('1','WA-support'),{...row('2',null),sender_type:'agent'}])).toBe('WA-support');
  });
  it('keeps Cloud restrictions when the latest incoming message is Cloud',()=>{
    expect(latestSessionOrigin([row('2',null,'2026-11-04T11:00:00Z'),row('1','WA-support')])).toBeNull();
  });
  it('uses the server tie-break and does not invent a line',()=>{
    expect(latestSessionOrigin([row('a','WA-old'),row('b','WA-new')])).toBe('WA-new');
    expect(latestSessionOrigin([])).toBeNull();
  });
});
