type IncomingEvent={eventType:string;new:Record<string,unknown>};
/** Bounded per-session deduplication, only fresh customer INSERTs, never history. */
export function createIncomingSoundGate(startedAt:number,now:()=>number=Date.now){
 const seen=new Set<string>();let lastPlayed=-Infinity;
 return (event:IncomingEvent)=>{
  const row=event.new,id=row?.id,created=typeof row?.created_at==='string'?Date.parse(row.created_at):NaN,time=now();
  if(event.eventType!=='INSERT'||row?.sender_type!=='customer'||typeof id!=='string'||!id||typeof row.conversation_id!=='string'||!row.conversation_id||!Number.isFinite(created)||created<startedAt-5000||created>time+60000||seen.has(id))return false;
  seen.add(id);if(seen.size>1000)seen.delete(seen.values().next().value!);
  if(time-lastPlayed<1500)return false;lastPlayed=time;return true;
 };
}
export const INSTICRECE_CHIME_NOTES=[{hz:659.25,at:0,duration:.16},{hz:830.61,at:.115,duration:.17},{hz:1108.73,at:.23,duration:.21}] as const;
/** Original soft ascending three-note signature; no recording or third-party sound. */
export function playInsticreceChime(context:AudioContext){
 if(context.state!=='running')return false;
 const start=context.currentTime+.01;
 for(const note of INSTICRECE_CHIME_NOTES){
  const oscillator=context.createOscillator(),gain=context.createGain(),at=start+note.at,end=at+note.duration;
  oscillator.type='sine';oscillator.frequency.setValueAtTime(note.hz,at);
  gain.gain.setValueAtTime(.0001,at);gain.gain.exponentialRampToValueAtTime(.1,at+.012);gain.gain.exponentialRampToValueAtTime(.0001,end);
  oscillator.connect(gain);gain.connect(context.destination);oscillator.start(at);oscillator.stop(end+.02);oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};
 }
 return true;
}
