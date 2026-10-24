import { describe, it, expect } from 'vitest'
import { deliveryStatusPatch } from './delivery-status'

describe('Meta delivery failures', () => {
  const base = {id:'wamid.test',status:'failed',timestamp:'1',recipient_id:'international'}
  it('preserves the error returned by Meta instead of only failed', () => {
    expect(deliveryStatusPatch({...base,errors:[{code:131026,title:'Message undeliverable',error_data:{details:'Recipient cannot receive this message'}}]}))
      .toEqual({status:'failed',delivery_error:{code:131026,title:'Message undeliverable',details:'Recipient cannot receive this message'},billing_recipient_id:'international'})
  })
  it('supports older status payloads without pricing', () => {
    expect(deliveryStatusPatch({...base,status:'sent'})).toEqual({status:'sent',delivery_error:null,billing_recipient_id:'international'})
  })
  it('clears the failure explanation when delivery succeeds', () => {
    expect(deliveryStatusPatch({...base,status:'delivered'})).toEqual({status:'delivered',delivery_error:null,billing_recipient_id:'international',billing_delivered_at:new Date(1000).toISOString()})
  })
  it('persists Meta billing classification and category only when the signed status contains pricing', () => {
    expect(deliveryStatusPatch({...base,status:'delivered',pricing:{billable:true,type:'regular',category:'utility',pricing_model:'PMP'}})).toEqual({
      status:'delivered',delivery_error:null,billing_status:'paid',billing_billable:true,
      billing_type:'regular',billing_category:'utility',billing_model:'PMP',
      billing_confirmed_at:new Date(1000).toISOString(),billing_recipient_id:'international',billing_delivered_at:new Date(1000).toISOString(),
    })
  })
  it('records an explicitly free Meta delivery without treating a missing field as free', () => {
    const free=deliveryStatusPatch({...base,status:'delivered',pricing:{billable:false,category:'service'}})
    expect(free).toMatchObject({billing_status:'free',billing_billable:false,billing_category:'service',billing_recipient_id:'international'})
    expect(deliveryStatusPatch({...base,status:'delivered'})).not.toHaveProperty('billing_status')
  })
  it('does not downgrade confirmed pricing when a later status omits the billable flag', () => {
    expect(deliveryStatusPatch({...base,status:'read',pricing:{category:'utility'}})).not.toHaveProperty('billing_status')
  })
  it('does not classify a failed delivery as billable even if pricing is present', () => {
    expect(deliveryStatusPatch({...base,pricing:{billable:true,category:'utility'}})).not.toHaveProperty('billing_status')
  })
})
