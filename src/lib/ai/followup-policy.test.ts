import {describe,it,expect} from 'vitest'
import {idleFollowupArea} from './followup-policy'

describe('sales and fidelity follow-up separation',()=>{
  it('keeps fidelity support out of sales automations',()=>{
    expect(idleFollowupArea([{role:'user',content:'Sigo esperando'}],'FIDELIZACION')).toBe('fidelizacion')
    expect(idleFollowupArea([{role:'user',content:'No puedo ingresar a mi clase'}],'VENTAS')).toBe('fidelizacion')
  })
  it('recognizes an explicit new sale without letting old fidelity context override it',()=>{
    expect(idleFollowupArea([{role:'user',content:'Quiero matricularme'}],'FIDELIZACION')).toBe('ventas')
    expect(idleFollowupArea([{role:'user',content:'Quiero información de otro curso'}],'FIDELIZACION')).toBe('ventas')
  })
})
