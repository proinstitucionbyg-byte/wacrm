import {describe,it,expect} from 'vitest'
import {hasRecentPaymentStage,idleFollowupArea,latestCourseSequenceFinished} from './followup-policy'

describe('sales and fidelity follow-up separation',()=>{
  it('stops after the final course block and keeps a newer partial course eligible',()=>{
    const courses = [{id:'education',name:'EDUCACION 19.90'},{id:'faq',name:'CONSULTAS'}]
    expect(latestCourseSequenceFinished([{automation_id:'faq',status:'success'},
      {automation_id:'education',status:'success'}],courses)).toBe(true)
    expect(latestCourseSequenceFinished([{automation_id:'education',status:'partial'},
      {automation_id:'education',status:'success'}],courses)).toBe(false)
  })
  it.each(['ASISTENTE A 19.90 (49.90)', 'INICIAL 19.90', 'RRHH 19.90'])('recognizes the saved course alias %s', name => {
    expect(latestCourseSequenceFinished([{automation_id:'root',status:'success'}], [{id:'root',name}])).toBe(true)
  })
  it('uses root metadata so a requested material cannot hide a finished sequence',()=>{
    expect(latestCourseSequenceFinished([
      {automation_id:'material',status:'partial'}, {automation_id:'root',status:'success'},
    ], [
      {id:'material',name:'MALLAS DE NUTRICION',trigger_config:{}},
      {id:'root',name:'NUTRICION 19.90',trigger_config:{sales_window_close:true}},
    ])).toBe(true)
  })
  it('keeps fidelity support out of sales automations',()=>{
    expect(idleFollowupArea([{role:'user',content:'Sigo esperando'}],'FIDELIZACION')).toBe('fidelizacion')
    expect(idleFollowupArea([{role:'user',content:'No puedo ingresar a mi clase'}],'VENTAS')).toBe('ventas')
    expect(idleFollowupArea([{role:'user',content:'Ya estoy matriculado'},{role:'user',content:'No puedo ingresar a mi clase'}],'VENTAS')).toBe('fidelizacion')
  })
  it('recognizes an explicit new sale without letting old fidelity context override it',()=>{
    expect(idleFollowupArea([{role:'user',content:'Quiero matricularme'}],'FIDELIZACION')).toBe('ventas')
    expect(idleFollowupArea([{role:'user',content:'Quiero información de otro curso'}],'FIDELIZACION')).toBe('ventas')
  })
})

describe('payment stage continuity',()=>{
  const now=Date.parse('2026-10-26T14:00:00Z')
  const payment={automation_id:'payment',status:'success',created_at:'2026-10-26T12:00:00Z'}
  const automations=[{id:'payment',name:'YAPE O PLIN',trigger_config:{payment_followup:true}},
    {id:'root',name:'ASISTENTE A 19.90 (49.90)',trigger_config:{sales_window_close:true}}]
  it('keeps payment through partial runs and linked course returns',()=>{
    expect(hasRecentPaymentStage([{automation_id:'root',status:'success',created_at:'2026-10-26T13:00:00Z',trigger_event:'automation_link'},payment],automations,now)).toBe(true)
    expect(hasRecentPaymentStage([{...payment,status:'partial'}],automations,now)).toBe(true)
  })
  it('releases payment only after a newer genuine course opening',()=>{
    const opening={automation_id:'root',status:'partial',created_at:'2026-10-26T13:00:00Z',trigger_event:'keyword_match:commercial_2026-10-25-v1'}
    expect(hasRecentPaymentStage([opening,payment],automations,now)).toBe(false)
    expect(hasRecentPaymentStage([{...opening,status:'failed'},payment],automations,now)).toBe(true)
  })
  it('does not use failed, future, missing-date or expired payment runs',()=>{
    for(const run of [{...payment,status:'failed'}, {...payment,created_at:undefined},
      {...payment,created_at:'2026-10-26T15:00:00Z'}, {...payment,created_at:'2026-10-25T14:00:00Z'}]) {
      expect(hasRecentPaymentStage([run],automations,now)).toBe(false)
    }
  })
  it('uses the most recent payment if a customer activated again after a new course',()=>{
    expect(hasRecentPaymentStage([{...payment,created_at:'2026-10-26T13:30:00Z'},
      {automation_id:'root',status:'success',created_at:'2026-10-26T13:00:00Z',trigger_event:'keyword_match'},payment],automations,now)).toBe(true)
  })
})
