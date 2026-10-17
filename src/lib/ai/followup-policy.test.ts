import {describe,it,expect} from 'vitest'
import {idleFollowupArea,latestCourseSequenceFinished} from './followup-policy'

describe('sales and fidelity follow-up separation',()=>{
  it('stops after the final course block and keeps a newer partial course eligible',()=>{
    const courses = [{id:'education',name:'EDUCACION 19.90'},{id:'faq',name:'CONSULTAS'}]
    expect(latestCourseSequenceFinished([{automation_id:'faq',status:'success'},
      {automation_id:'education',status:'success'}],courses)).toBe(true)
    expect(latestCourseSequenceFinished([{automation_id:'education',status:'partial'},
      {automation_id:'education',status:'success'}],courses)).toBe(false)
  })
  it('keeps fidelity support out of sales automations',()=>{
    expect(idleFollowupArea([{role:'user',content:'Sigo esperando'}],'FIDELIZACION')).toBe('fidelizacion')
    expect(idleFollowupArea([{role:'user',content:'No puedo ingresar a mi clase'}],'VENTAS')).toBe('fidelizacion')
  })
  it('recognizes an explicit new sale without letting old fidelity context override it',()=>{
    expect(idleFollowupArea([{role:'user',content:'Quiero matricularme'}],'FIDELIZACION')).toBe('ventas')
    expect(idleFollowupArea([{role:'user',content:'Quiero información de otro curso'}],'FIDELIZACION')).toBe('ventas')
  })
})
