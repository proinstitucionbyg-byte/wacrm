export type DispatchJob={id:string;contact_id:string;recipient:string;status:string;started_at:string|null;provider_id:string|null;predecessor_id:string|null;campaign_sequence:number;campaign_step:number;line_key:string};
/** Same predecessor fence as the database: uncertain/failed steps are never replayed. */
export function safeDispatchJobs(jobs:DispatchJob[]){
 const byId=new Map(jobs.map(j=>[j.id,j])),safe=new Set<string>();
 const ordered=[...jobs].sort((a,b)=>a.campaign_sequence-b.campaign_sequence||a.campaign_step-b.campaign_step||a.id.localeCompare(b.id));
 return ordered.filter(j=>{
  if(j.status!=='queued'||j.started_at||j.provider_id)return false;
  const previous=j.predecessor_id?byId.get(j.predecessor_id):null;
  if(j.predecessor_id&&!safe.has(j.predecessor_id)&&!['accepted','delivered'].includes(previous?.status??''))return false;
  safe.add(j.id);return true;
 });
}
export function selectDispatchBatch(jobs:DispatchJob[],count:number,unit:'messages'|'recipients'){
 const safe=safeDispatchJobs(jobs);
 if(unit==='messages')return safe.slice(0,count);
 const contacts=new Set<string>();
 for(const j of safe){if(contacts.size>=count&&!contacts.has(j.contact_id))break;contacts.add(j.contact_id);}
 return safe.filter(j=>contacts.has(j.contact_id));
}
