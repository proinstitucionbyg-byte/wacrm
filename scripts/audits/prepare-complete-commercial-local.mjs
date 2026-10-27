// Offline plan only. No Supabase client, credentials, SQL or network calls.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {buildCompleteCommercialCadence,COMPLETE_CADENCE_VERSION} from '../../src/lib/automations/commercial-cadence.ts'
const snapshot=JSON.parse(readFileSync(new URL('../../src/lib/automations/__fixtures__/commercial-courses-2026-10-27.json',import.meta.url),'utf8').replace(/^\uFEFF/,''))
const patch=(row,config)=>({id:row.id,name:row.name,
  expected_trigger_config_sha256:createHash('sha256').update(JSON.stringify(row.trigger_config)).digest('hex'),
  before:row.trigger_config,after:{...row.trigger_config,...config}})
const courses=snapshot.courses.map(course=>patch(course,{
  commercial_cadence:buildCompleteCommercialCadence(course.steps),commercial_version:COMPLETE_CADENCE_VERSION,
}))
const secondary=snapshot.secondary.map(route=>{
  const links=route.steps.filter(s=>s.step_type==='run_automation')
  if(!links.length || links.some(link=>{
    const c=snapshot.courses.find(c=>c.id===link.step_config.automation_id)
    return !c || !Number.isInteger(link.step_config.start_step) || link.step_config.start_step<4
      || link.step_config.end_step!==55
  }))throw Error(`Revisar conexión antes de preparar ${route.name}`)
  return patch(route,{course_detour:true,course_response_only:true})
})
const plan={status:'LOCAL_ONLY_NOT_PUBLISHED',snapshot:snapshot.snapshot,
  instructions:'Requiere autorización para publicar. Volver a leer configuración y comprobar todos los precondicionados; no aplicar si cambió. No modifica trabajos existentes, pausas, pagos, keywords ni contenidos.',
  courses,secondary,
}
mkdirSync('output/commercial-complete-2026-10-27',{recursive:true})
writeFileSync('output/commercial-complete-2026-10-27/plan-local.json',JSON.stringify(plan,null,2)+'\n')
console.log(JSON.stringify({status:plan.status,courses:courses.length,secondary:secondary.length,steps:courses.map(c=>c.after.commercial_cadence.steps.length)}))
