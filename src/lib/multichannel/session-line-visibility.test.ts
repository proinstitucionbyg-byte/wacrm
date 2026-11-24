import {expect,it} from 'vitest';
import {visibleSessionLines,canEnableSessionLine} from './session-line-visibility';
it('only enables a fresh, connected, current and phone-matched session',()=>{
 const now=Date.now(),line={line_key:'WA-one',linked_phone:'51900000001'};
 const current={lineKey:line.line_key,label:'Soporte',status:'ready',active:true,linkedPhone:line.linked_phone,qr:null};
 const state={snapshot:[current],seen_at:new Date(now).toISOString()};
 expect(canEnableSessionLine(line,state,now)).toBe(true);
 for(const patch of [{archived:true},{label:'Historial anterior'},{active:false},{status:'stopped'},{linkedPhone:'51900000002'}])expect(canEnableSessionLine(line,{...state,snapshot:[{...current,...patch}]},now)).toBe(false);
 expect(canEnableSessionLine(line,{...state,seen_at:new Date(now-21000).toISOString()},now)).toBe(false);
 expect(canEnableSessionLine(line,null,now)).toBe(false);
});
it('removes archived numbers from operational lists without deleting their records or hiding paused current lines',()=>{
 const lines=[{line_key:'WA-old',worker_id:'worker',paused:true},{line_key:'WA-new',worker_id:'worker',paused:true}];
 const states=[{worker_id:'worker',snapshot:[{lineKey:'WA-old',label:'Anterior',archived:true,status:'stopped',active:false,linkedPhone:'51900000001',qr:null},{lineKey:'WA-new',label:'Soporte',archived:false,status:'stopped',active:false,linkedPhone:'51900000002',qr:null}]}];
 expect(visibleSessionLines(lines,states)).toEqual([lines[1]]);expect(lines).toHaveLength(2);
});
it('does not use another worker snapshot to hide a line',()=>{
 expect(visibleSessionLines([{line_key:'WA-old',worker_id:'one'}],[{worker_id:'two',snapshot:[{lineKey:'WA-old',label:'Anterior',archived:true,status:'stopped',active:false,linkedPhone:'51900000001',qr:null}]}])).toHaveLength(1);
});
