export interface ReferenceStep {
  id: string
  automation_id: string
  parent_step_id: string | null
  branch: string | null
  position: number
  step_type: string
  step_config: Record<string, unknown>
}

export interface ReferenceImpact {
  automationId: string
  automationName: string
  folder: string
  block: string
  before: string
  after: string
  problem?: string
}

/** Labels are display numbers; identity follows the stored block UUID. */
export function planReferenceChanges(targetId: string, before: ReferenceStep[], after: ReferenceStep[],
  links: ReferenceStep[], names: Map<string, {name: string; folder: string}>) {
  const oldRoots = before.filter(s => !s.parent_step_id).sort((a,b) => a.position-b.position)
  const newRoots = after.filter(s => !s.parent_step_id).sort((a,b) => a.position-b.position)
  const positions = new Map(newRoots.map(s => [s.id,s.position+1]))
  const impacts: ReferenceImpact[] = []
  const patches: {id:string; step_config:Record<string,unknown>}[] = []
  for (const link of links) {
    const cfg = link.step_config
    if (cfg.automation_id !== targetId || cfg.start_step === undefined && cfg.end_step === undefined) continue
    const start = Number(cfg.start_step), end = Number(cfg.end_step)
    const startRow = oldRoots.find(s => s.position === start-1)
    const endRow = oldRoots.find(s => s.position === end-1)
    const nextStart = startRow ? positions.get(startRow.id) : undefined
    // A range reaching the last block continues to reach the end after an append.
    const nextEnd = end === oldRoots.length ? newRoots.length : endRow ? positions.get(endRow.id) : undefined
    const problem = !nextStart || !nextEnd || !startRow || !endRow
      ? 'Se eliminó un bloque usado por este enlace. Cancela la eliminación o corrige el enlace antes de guardar.'
      : nextStart > nextEnd ? 'El inicio quedó después del final. Revisa el orden de los bloques.' : undefined
    if (!problem && nextStart === start && nextEnd === end) continue
    const name = names.get(link.automation_id)
    impacts.push({automationId:link.automation_id,automationName:name?.name ?? link.automation_id,
      folder:name?.folder ?? 'Sin carpeta',block:link.parent_step_id ? 'Dentro de una condición' : `A${link.position+1}`,
      before:`A${start}–A${end}`,after:problem ? 'Necesita revisión' : `A${nextStart}–A${nextEnd}`,problem})
    if (!problem) patches.push({id:link.id,step_config:{...cfg,start_step:nextStart,end_step:nextEnd}})
  }
  return {impacts,patches}
}

export function remapPendingPosition(before: ReferenceStep[], after: ReferenceStep[], position: number,
  parent: string | null, branch: string | null): number | null {
  const old = before.filter(s => s.parent_step_id===parent && s.branch===branch).sort((a,b)=>a.position-b.position)
  const next = after.filter(s => s.parent_step_id===parent && s.branch===branch).sort((a,b)=>a.position-b.position)
  if (parent && !after.some(s=>s.id===parent)) return null
  if (!old.some(s=>s.position>=position)) {
    const last=old.at(-1)
    const survivingLast=last ? next.find(s=>s.id===last.id) : undefined
    return survivingLast ? survivingLast.position+1 : next.length
  }
  // If the next unsent block was removed, continue at the next surviving block.
  for (const step of old.filter(s=>s.position>=position)) {
    const found=next.find(s=>s.id===step.id)
    if(found) return found.position
  }
  return next.length
}
