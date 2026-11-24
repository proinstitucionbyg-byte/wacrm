import {describe,expect,it,vi} from 'vitest';
import {createIncomingSoundGate,playInsticreceChime,INSTICRECE_CHIME_NOTES} from './incoming-sound';
const started=Date.parse('2026-11-17T15:00:00Z');
const event=(patch:Record<string,unknown>={})=>({eventType:'INSERT',new:{id:'one',conversation_id:'chat',sender_type:'customer',created_at:new Date(started).toISOString(),...patch}});
describe('incoming sound policy',()=>{
 it('accepts fresh inbound messages only once',()=>{const gate=createIncomingSoundGate(started,()=>started);expect(gate(event())).toBe(true);expect(gate(event())).toBe(false);});
 it('does not ring for history, outgoing messages, updates or bad dates',()=>{
  for(const bad of [event({created_at:new Date(started-6000).toISOString()}),event({sender_type:'agent'}),event({created_at:'invalid'}),event({created_at:new Date(started+61000).toISOString()}),{...event(),eventType:'UPDATE'}])expect(createIncomingSoundGate(started,()=>started)(bad)).toBe(false);
 });
 it('groups bursts without replaying skipped messages later',()=>{let now=started;const gate=createIncomingSoundGate(started,()=>now);expect(gate(event())).toBe(true);expect(gate(event({id:'two'}))).toBe(false);now+=1600;expect(gate(event({id:'two'}))).toBe(false);expect(gate(event({id:'three'}))).toBe(true);});
 it('does not schedule a sound while blocked by the browser',()=>{const context={state:'suspended',createOscillator:vi.fn()} as unknown as AudioContext;expect(playInsticreceChime(context)).toBe(false);expect(context.createOscillator).not.toHaveBeenCalled();});
 it('schedules the original three notes with quiet envelopes and cleanup',()=>{
  const oscillators:Record<string,unknown>[]=[],gains:Record<string,unknown>[]=[];
  const context={state:'running',currentTime:1,destination:{},createOscillator:()=>{const o={frequency:{setValueAtTime:vi.fn()},connect:vi.fn(),start:vi.fn(),stop:vi.fn(),disconnect:vi.fn(),onended:null as null|(()=>void)};oscillators.push(o);return o;},createGain:()=>{const g={gain:{setValueAtTime:vi.fn(),exponentialRampToValueAtTime:vi.fn()},connect:vi.fn(),disconnect:vi.fn()};gains.push(g);return g;}};
  expect(playInsticreceChime(context as unknown as AudioContext)).toBe(true);expect(oscillators).toHaveLength(3);
  oscillators.forEach((o,i)=>{expect((o.frequency as {setValueAtTime:ReturnType<typeof vi.fn>}).setValueAtTime).toHaveBeenCalledWith(INSTICRECE_CHIME_NOTES[i].hz,1.01+INSTICRECE_CHIME_NOTES[i].at);(o.onended as ()=>void)();expect(o.disconnect).toHaveBeenCalled();expect(gains[i].disconnect).toHaveBeenCalled();});
 });
});
