import {describe,it,expect} from 'vitest'
import {captureCourseCheckpoint,currentCourseCheckpoint,restoreCourseCheckpoint,isCourseDetour,isCourseContinue} from './course-detour'

const NOW=Date.parse('2026-10-19T18:00:00Z')
const checkpoint={pending_ids:['parent','leaf'],captured_at:'2026-10-19T17:45:00Z'}
function fixture(){
 const state={
  automation_pending_executions:[
   {id:'parent',account_id:'a',contact_id:'c',automation_id:'aux',status:'cancelled',run_at:'2026-10-19T17:50:00Z',next_step_position:3,context:{conversation_id:'chat',await_child_log_id:'child'}},
   {id:'leaf',account_id:'a',contact_id:'c',automation_id:'course',status:'cancelled',run_at:'2026-10-19T20:00:00Z',next_step_position:29,context:{conversation_id:'chat'}},
  ] as any[],
  automations:[{id:'aux',account_id:'a',name:'MALLAS DE NUTRICION',is_active:true},{id:'course',account_id:'a',name:'NUTRICION 19.90 (49.90)',is_active:true}] as any[],
  conversations:[{id:'chat',account_id:'a',contact_id:'c',automation_enabled:true,last_human_message_at:null}] as any[],
  messages:[] as any[],payment_reviews:[] as any[],race:false,updates:[] as any[],
 }
 const db={from:(table:string)=>{
  const filters:((r:any)=>boolean)[]=[];let update:any;let single=false
  const resolve=()=>{
   let rows=(state[table]||[]).filter(r=>filters.every(f=>f(r)))
   if(update){
    if(state.race&&table==='automation_pending_executions') {rows=rows.slice(0,1);state.race=false}
    state.updates.push({table,payload:update,ids:rows.map(r=>r.id)})
    rows.forEach(r=>Object.assign(r,update))
   }
   return {data:single?rows[0]??null:rows,error:null}
  }
  const q:any={select:()=>q,order:()=>q,limit:()=>q,
   eq:(k:string,v:any)=>(filters.push(r=>r[k]===v),q),
   in:(k:string,v:any[])=>(filters.push(r=>v.includes(r[k])),q),
   gt:(k:string,v:any)=>(filters.push(r=>r[k]>v),q),
   gte:(k:string,v:any)=>(filters.push(r=>r[k]>=v),q),
   update:(value:any)=>(update=value,q),
   maybeSingle:()=>{single=true;return Promise.resolve(resolve())},
   then:(fn:any)=>Promise.resolve(resolve()).then(fn),
  };return q
 }} as any
 const restore=(opts:any={})=>restoreCourseCheckpoint(db,{account:'a',contact:'c',chat:'chat',checkpoint,automatic:true,now:NOW,...opts})
 return {db,state,restore}
}
describe('saved course detours',()=>{
 it('only enables the explicit detour/continue flags',()=>{
  expect(isCourseDetour({trigger_config:{course_detour:true}})).toBe(true)
  expect(isCourseContinue({trigger_config:{course_continue:true}})).toBe(true)
  expect(isCourseDetour({trigger_config:{}})).toBe(false)
 })
 it('captures both linked positions without altering dates or positions',async()=>{
  const {db,state}=fixture();state.automation_pending_executions.forEach(r=>r.status='pending')
  const before=state.automation_pending_executions.map(r=>[r.run_at,r.next_step_position])
  const r=await captureCourseCheckpoint(db,'a','c','chat')
  expect(r.busy).toBe(false);expect(r.checkpoint?.pending_ids).toEqual(['parent','leaf'])
  expect(state.automation_pending_executions.map(r=>r.status)).toEqual(['cancelled','cancelled'])
  expect(state.automation_pending_executions.map(r=>[r.run_at,r.next_step_position])).toEqual(before)
 })
 it('recognizes the actual Administrativo name and its generic linked parent',async()=>{
  const {db,state}=fixture();state.automation_pending_executions.forEach(r=>r.status='pending')
  state.automations[0].name='🎁 Ver beneficios (49.90)';state.automations[1].name='ASISTENTE A 19.90 (49.90)'
  state.automation_pending_executions[1].log_id='child'
  expect((await captureCourseCheckpoint(db,'a','c','chat')).checkpoint?.pending_ids.sort()).toEqual(['leaf','parent'])
 })
 it('does not pause a course currently sending',async()=>{
  const {db,state}=fixture();state.automation_pending_executions[0].status='pending';state.automation_pending_executions[1].status='running'
  expect(await captureCourseCheckpoint(db,'a','c','chat')).toEqual({busy:true});expect(state.updates).toHaveLength(0)
 })
 it('rolls back the rows it paused if a concurrent claim wins',async()=>{
  const {db,state}=fixture();state.automation_pending_executions.forEach(r=>r.status='pending');state.race=true
  expect((await captureCourseCheckpoint(db,'a','c','chat')).busy).toBe(true)
  expect(state.automation_pending_executions.every(r=>r.status==='pending')).toBe(true)
 })
 it('keeps an inherited checkpoint across another Minedu question',async()=>{
  const {db,state}=fixture();state.automation_pending_executions=[{id:'detour',account_id:'a',contact_id:'c',automation_id:'minedu',status:'pending',context:{conversation_id:'chat',course_checkpoint:checkpoint}}]
  expect(await currentCourseCheckpoint(db,'a','c','chat')).toEqual(checkpoint)
  expect((await captureCourseCheckpoint(db,'a','c','chat')).checkpoint).toEqual(checkpoint)
 })
 it('retains the original course when a second question interrupts a named course detour',async()=>{
  const {db,state}=fixture()
  state.automations[0].name='PARA QUE ESTUDIAR ASISTENTE ADMINISTRATIVO (49.90)'
  state.automations[0].trigger_config={course_detour:true,course_response_only:true}
  state.automation_pending_executions=[{id:'parent',account_id:'a',contact_id:'c',automation_id:'aux',
   status:'pending',run_at:'2026-10-19T17:50:00Z',context:{conversation_id:'chat',course_checkpoint:checkpoint}}]
  expect((await captureCourseCheckpoint(db,'a','c','chat')).checkpoint).toEqual(checkpoint)
  expect(state.updates).toHaveLength(0)
 })
 it('restores all positions and never advances a future wait',async()=>{
  const {state,restore}=fixture();expect(await restore()).toBe('restored')
  expect(state.automation_pending_executions.map(r=>r.next_step_position)).toEqual([3,29])
  expect(state.automation_pending_executions.map(r=>r.run_at)).toEqual(['2026-10-19T18:00:00.000Z','2026-10-19T20:00:00.000Z'])
  expect(state.automation_pending_executions.every(r=>r.status==='pending')).toBe(true)
  expect(state.updates.at(-1).ids).toEqual(['parent','leaf'])
 })
 it('does not resume if another course is active',async()=>{
  const {state,restore}=fixture();state.automation_pending_executions.push({id:'new',account_id:'a',contact_id:'c',status:'pending',context:{conversation_id:'chat'}})
  expect(await restore()).toBe('superseded');expect(state.updates).toHaveLength(0)
 })
 it('ignores only the current automatic timer',async()=>{
  const {state,restore}=fixture();state.automation_pending_executions.push({id:'timer',account_id:'a',contact_id:'c',status:'running',context:{conversation_id:'chat'}})
  expect(await restore({ignorePendingId:'timer'})).toBe('restored')
 })
 it('stops the automatic return after a new customer message',async()=>{
  const {state,restore}=fixture();state.messages.push({id:'msg',conversation_id:'chat',sender_type:'customer',created_at:'2026-10-19T17:50:00Z'})
  expect(await restore()).toBe('superseded')
  expect(await restore({automatic:false})).toBe('restored')
 })
 it('does not override human attention or disabled automation',async()=>{
  for(const conv of [{automation_enabled:false},{last_human_message_at:'2026-10-19T17:55:00Z'}]){
   const {state,restore}=fixture();Object.assign(state.conversations[0],conv);expect(await restore()).toBe('human');expect(state.updates).toHaveLength(0)
  }
 })
 it('does not resume the sale after new payment evidence',async()=>{
  const {state,restore}=fixture();state.payment_reviews.push({id:'payment',account_id:'a',contact_id:'c',created_at:'2026-10-19T17:55:00Z'})
  expect(await restore()).toBe('superseded')
 })
 it('does not restore another account, chat or a missing row',async()=>{
  for(const change of [{account_id:'other'},{context:{conversation_id:'other'}},{status:'done'}]){
   const {state,restore}=fixture();Object.assign(state.automation_pending_executions[1],change);expect(await restore()).toBe('missing');expect(state.updates).toHaveLength(0)
  }
 })
 it('does not restore a disabled original automation',async()=>{
  const {state,restore}=fixture();state.automations[1].is_active=false;expect(await restore()).toBe('superseded')
 })
 it('retains a payment follow-up when that was the interrupted point',async()=>{
  const {db,state}=fixture();state.automation_pending_executions=state.automation_pending_executions.slice(1)
  state.automation_pending_executions[0].status='pending';state.automations[1].name='YAPE O PLIN'
  expect((await captureCourseCheckpoint(db,'a','c','chat')).checkpoint?.pending_ids).toEqual(['leaf'])
 })
 it('does not capture a human-managed enrollment',async()=>{
  const {db,state}=fixture();state.automation_pending_executions.forEach(r=>{r.status='pending';r.context.enrollment_sequence_id='welcome'})
  expect(await captureCourseCheckpoint(db,'a','c','chat')).toEqual({checkpoint:undefined,busy:false})
 })
})
