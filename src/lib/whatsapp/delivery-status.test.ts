import { describe, it, expect } from 'vitest'
import { deliveryStatusPatch } from './delivery-status'

describe('Meta delivery failures', () => {
  const base = {id:'wamid.test',status:'failed',timestamp:'1',recipient_id:'international'}
  it('preserves the error returned by Meta instead of only failed', () => {
    expect(deliveryStatusPatch({...base,errors:[{code:131026,title:'Message undeliverable',error_data:{details:'Recipient cannot receive this message'}}]}))
      .toEqual({status:'failed',delivery_error:{code:131026,title:'Message undeliverable',details:'Recipient cannot receive this message'}})
  })
  it('supports older status payloads without errors', () => {
    expect(deliveryStatusPatch(base)).toEqual({status:'failed',delivery_error:null})
  })
  it('clears the failure explanation when delivery succeeds', () => {
    expect(deliveryStatusPatch({...base,status:'delivered'})).toEqual({status:'delivered',delivery_error:null})
  })
})
