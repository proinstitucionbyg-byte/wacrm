import {createHash} from 'node:crypto'
import {supabaseAdmin} from './admin-client'
import {flattenSteps, type BuilderStepInput} from './steps-tree'
import {planReferenceChanges,remapPendingPosition,type ReferenceStep} from './reference-impact'

function canonical(value: unknown): string {
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']'
  if(value && typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}'
  return JSON.stringify(value) ?? 'null'
}
export const snapshotHash=(value:unknown)=>createHash('sha256').update(canonical(value)).digest('hex')

export async function automationSnapshot(accountId:string,id:string) {
  const db=supabaseAdmin()
  const [a,s,l,p,ns,fs]=await Promise.all([
    db.from('automations').select('*').eq('id',id).eq('account_id',accountId).single(),
    db.from('automation_steps').select('*').eq('automation_id',id).order('id'),
    db.from('automation_steps').select('*,automations!inner(account_id)').eq('automations.account_id',accountId)
      .eq('step_type','run_automation').contains('step_config',{automation_id:id}).order('id'),
    db.from('automation_pending_executions').select('*').eq('account_id',accountId)
      .in('status',['pending','running','cancelled']).order('id'),
    db.from('automations').select('id,name,folder_id').eq('account_id',accountId),
    db.from('automation_folders').select('id,name,parent_id').eq('account_id',accountId),
  ])
  for(const r of [a,s,l,p,ns,fs])if(r.error)throw Error(r.error.message)
  const pending=(p.data??[]).filter(row=>row.automation_id===id || Object.hasOwn(row.context?.automation_step_end_by_id??{},id))
  const links=(l.data??[]).map(({automations: _account,...row})=>row)
  function path(folderId:string|null):string {
    const out:string[]=[]; const seen=new Set<string>()
    while(folderId&&!seen.has(folderId)){seen.add(folderId);const f=fs.data?.find(f=>f.id===folderId);if(!f)break;out.unshift(f.name);folderId=f.parent_id}
    return out.join(' / ')||'Sin carpeta'
  }
  const names=new Map((ns.data??[]).map(n=>[n.id,{name:n.name,folder:path(n.folder_id)}]))
  return {expected:{automation:a.data,steps:s.data??[],links,pending},names}
}

export function buildSaveImpact(snapshot:Awaited<ReturnType<typeof automationSnapshot>>,input:BuilderStepInput[],update:Record<string,unknown>) {
  const {expected,names}=snapshot
  const id=expected.automation.id
  const rows=flattenSteps(id,input)
  const ids=new Set(rows.map(r=>r.id))
  if(ids.size!==rows.length)throw Error('Hay bloques con el mismo identificador. Recarga el editor.')
  const {impacts,patches}=planReferenceChanges(id,expected.steps as ReferenceStep[],rows,expected.links as ReferenceStep[],names)
  const pendingPatches:{id:string;next_step_position:number;context:Record<string,unknown>}[]=[]
  const problems=impacts.filter(x=>x.problem).map(x=>x.problem!)
  const structural=snapshotHash(expected.steps.map(s=>[s.id,s.position,s.parent_step_id,s.branch]).sort())!==snapshotHash(rows.map(s=>[s.id,s.position,s.parent_step_id,s.branch]).sort())
  for(const p of expected.pending) {
    if(structural&&p.status==='running'){problems.push('Hay un envío en curso. Espera unos segundos y vuelve a guardar.');continue}
    const context=structuredClone(p.context??{})
    let position=p.next_step_position
    if(p.automation_id===id){
      const mapped=remapPendingPosition(expected.steps as ReferenceStep[],rows,position,p.parent_step_id,p.branch)
      if(mapped===null){problems.push('Una conversación espera dentro de una condición que eliminaste. Conserva esa condición antes de guardar.');continue}
      position=mapped
    }
    const end=context.automation_step_end_by_id?.[id]
    if(typeof end==='number') {
      const oldRoots=expected.steps.filter(s=>!s.parent_step_id)
      const oldEnd=oldRoots.find(s=>s.position===end)
      const newEnd=oldEnd ? rows.find(s=>s.id===oldEnd.id&&!s.parent_step_id) : undefined
      if(end===oldRoots.length-1)context.automation_step_end_by_id[id]=rows.filter(s=>!s.parent_step_id).length-1
      else if(newEnd)context.automation_step_end_by_id[id]=newEnd.position
      else {problems.push('Se eliminó el final de un tramo que usa una conversación. Conserva ese bloque.');continue}
    }
    if(position!==p.next_step_position || snapshotHash(context)!==snapshotHash(p.context))pendingPatches.push({id:p.id,next_step_position:position,context})
  }
  const selfPatches=new Map(patches.map(p=>[p.id,p.step_config]))
  for(const row of rows)if(selfPatches.has(row.id))row.step_config=selfPatches.get(row.id)!
  return {rows,patches:patches.filter(p=>!ids.has(p.id)),pendingPatches,impacts,problems:[...new Set(problems)],structural,
    token:snapshotHash({expected,rows,update}),revision:snapshotHash(expected.steps),
    summary:{before:expected.steps.filter(s=>!s.parent_step_id).length,after:rows.filter(s=>!s.parent_step_id).length,
      unchangedLinks:expected.links.length-impacts.length,pendingChanges:pendingPatches.length}}
}
