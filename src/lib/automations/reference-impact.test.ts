import {describe,it,expect} from 'vitest'
import {planReferenceChanges,remapPendingPosition,type ReferenceStep} from './reference-impact'
const block=(id:string,position:number):ReferenceStep=>({id,position,automation_id:'course',parent_step_id:null,branch:null,step_type:'send_message',step_config:{text:id}})
const old=Array.from({length:53},(_,i)=>block(`s${i+1}`,i))
const names=new Map([['caller',{name:'Desde cero Nutrición',folder:'Datos / Desde cero'}]])
const link=(start:number,end:number):ReferenceStep=>({...block('link',2),automation_id:'caller',step_type:'run_automation',step_config:{automation_id:'course',start_step:start,end_step:end}})
const insert=(at:number)=>[...old.slice(0,at),block('new',at),...old.slice(at)].map((s,i)=>({...s,position:i}))
describe('linked block identity',()=>{
 it('moves both limits when a block is inserted before A8',()=>{
   const result=planReferenceChanges('course',old,insert(5),[link(8,53)],names)
   expect(result.patches[0].step_config).toMatchObject({start_step:9,end_step:54})
   expect(result.impacts[0]).toMatchObject({automationName:'Desde cero Nutrición',folder:'Datos / Desde cero',before:'A8–A53',after:'A9–A54'})
 })
 it('keeps the start when inserting inside the selected range',()=>{
   expect(planReferenceChanges('course',old,insert(10),[link(9,53)],names).patches[0].step_config).toMatchObject({start_step:9,end_step:54})
 })
 it('extends a range that goes to the end when appending',()=>{
   expect(planReferenceChanges('course',old,insert(53),[link(8,53)],names).patches[0].step_config.end_step).toBe(54)
 })
 it('leaves earlier finite ranges and full-automation links alone',()=>{
   expect(planReferenceChanges('course',old,insert(10),[link(2,4),{...link(1,53),step_config:{automation_id:'course'}}],names).impacts).toEqual([])
 })
 it('blocks deleting a referenced start instead of guessing',()=>{
   const after=old.filter(s=>s.id!=='s8').map((s,i)=>({...s,position:i}))
   const result=planReferenceChanges('course',old,after,[link(8,53)],names)
   expect(result.patches).toEqual([]);expect(result.impacts[0].problem).toBeTruthy()
 })
 it('blocks a range inverted by moving its endpoints',()=>{
   const after=[...old];[after[7],after[20]]=[after[20],after[7]]
   expect(planReferenceChanges('course',old,after.map((s,i)=>({...s,position:i})),[link(8,10)],names).impacts[0].problem).toBeTruthy()
 })
 it('retains the next unsent block and terminal position for waiting chats',()=>{
   expect(remapPendingPosition(old,insert(5),7,null,null)).toBe(8)
   expect(remapPendingPosition(old,insert(5),53,null,null)).toBe(54)
   expect(remapPendingPosition(old,insert(53),53,null,null)).toBe(53)
 })
 it('uses the next surviving unsent block when the upcoming one was removed',()=>{
   const after=old.filter(s=>s.id!=='s8').map((s,i)=>({...s,position:i}))
   expect(remapPendingPosition(old,after,7,null,null)).toBe(7)
 })
})
