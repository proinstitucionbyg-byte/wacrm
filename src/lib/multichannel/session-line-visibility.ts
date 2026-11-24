import {managementSnapshotLine} from './whatsapp-management';

export function canEnableSessionLine(line:{line_key:string;linked_phone:string},state:{snapshot:unknown;seen_at:string}|null,now=Date.now()) {
  if(!state)return false;
  const age=now-Date.parse(state.seen_at);
  if(!Number.isFinite(age)||age<0||age>20000)return false;
  const parsed=managementSnapshotLine.array().safeParse(state.snapshot);
  const current=parsed.success?parsed.data.find(item=>item.lineKey===line.line_key):null;
  return !!current&&!current.archived&&!current.label.startsWith('Historial ')&&current.active&&current.status==='ready'&&current.linkedPhone===line.linked_phone;
}

export function visibleSessionLines<T extends {line_key:string;worker_id:string}>(lines:T[],states:{worker_id:string;snapshot:unknown}[]):T[] {
  return lines.filter(line=>{
    const state=states.find(item=>item.worker_id===line.worker_id);
    if(!state)return true;
    const parsed=managementSnapshotLine.array().safeParse(state.snapshot);
    const match=parsed.success?parsed.data.find(item=>item.lineKey===line.line_key):null;
    return !match || !(match.archived || match.label.startsWith('Historial '));
  });
}
