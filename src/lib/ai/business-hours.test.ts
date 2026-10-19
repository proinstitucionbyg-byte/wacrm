import {describe,it,expect} from 'vitest'
import {buildHandoffNotice,buildWaitingReminder} from './business-hours'
describe('advisor contact notices',()=>{
 const open=Date.parse('2026-10-19T16:00:00Z')
 const closed=Date.parse('2026-10-18T16:00:00Z')
 it.each(['ventas','fidelizacion','egresados'])('explains call or message contact in %s',area=>{
  for(const now of [open,closed])for(const agentConnected of [true,false]){
   const text=buildHandoffNotice({area,now,agentConnected})
   expect(text).toContain('especializada');expect(text).toContain('llamada o mensaje')
   expect(text).toContain('mantente atento');expect(text).not.toContain('En unos minutos')
   if(!agentConnected&&now===open)expect(text).toContain('verificando la disponibilidad')
   if(!agentConnected&&now===closed)expect(text).toContain('fuera de horario')
  }
 })
 it('keeps waiting reminders and sensitive cases consistent',()=>{
  for(const now of [open,closed]){
   expect(buildWaitingReminder(now)).toContain('llamada o mensaje')
   expect(buildHandoffNotice({area:'fidelizacion',agentConnected:false,delicate:true,now})).toContain('llamada o mensaje')
  }
 })
})
