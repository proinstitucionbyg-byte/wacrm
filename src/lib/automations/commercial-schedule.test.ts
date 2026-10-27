import {describe,it,expect} from 'vitest'
import {planCommercialWait} from './commercial-schedule'
const date=(day:number,time:string)=>`2026-10-${day}T${time}:00-05:00`
const plan=(hour:string,opts:Partial<Parameters<typeof planCommercialWait>[0]>={})=>planCommercialWait({
  now:Date.parse(date(27,hour)),startedAt:date(27,'01:00'),lastCustomerAt:date(27,'01:00'),position:4,remainingWaits:15,...opts})
describe('Lima commercial scheduling',()=>{
  it('keeps the initial listening interval at night',()=>expect(plan('01:00',{position:2}).runAt).toBe('2026-10-27T06:02:00.000Z'))
  it.each([['01:02','06:00'],['06:00','07:00'],['07:00','08:00'],['08:00','11:00']])('resumes from %s at %s', (now,due)=>{
    expect(plan(now).runAt).toBe(new Date(date(27,due)).toISOString())
  })
  it('spaces the 11am band by 20-25 minutes',()=>{
    expect(plan('11:00').runAt).toBe(new Date(date(27,'11:20')).toISOString())
    expect(plan('11:00',{position:7}).runAt).toBe(new Date(date(27,'11:25')).toISOString())
  })
  it('respects the afternoon rest',()=>expect(plan('14:20',{remainingWaits:5}).runAt).toBe(new Date(date(27,'16:00')).toISOString()))
  it('continues the afternoon band',()=>expect(plan('16:00').runAt).toBe(new Date(date(27,'16:20')).toISOString()))
  it('moves a late arrival to morning when all remaining blocks fit',()=>{
    expect(plan('22:00',{lastCustomerAt:date(27,'21:00'),startedAt:date(27,'21:00')}).runAt).toBe(new Date(date(28,'06:00')).toISOString())
  })
  it('uses exceptional night spacing when morning would exceed the deadline',()=>{
    expect(plan('22:00',{remainingWaits:2}).runAt).toBe(new Date(date(27,'22:20')).toISOString())
  })
  it('anchors the final closing near 23 hours',()=>expect(plan('17:00',{position:53}).runAt).toBe(new Date(date(28,'00:00')).toISOString()))
  it('recalculates after a genuine new inbound',()=>expect(plan('17:00',{position:53,lastCustomerAt:date(27,'14:00')}).runAt).toBe(new Date(date(28,'13:00')).toISOString()))
  it('a late exceptional restart closes against the original inbound window',()=>expect(plan('17:00',{position:53,startedAt:date(27,'17:00')}).runAt).toBe(new Date(date(28,'00:00')).toISOString()))
  it('prioritizes essential blocks with less than two hours',()=>expect(plan('23:00').prioritizeEssential).toBe(true))
  it('never schedules a free-form message after expiry',()=>{
    expect(plan('23:50',{now:Date.parse(date(28,'00:50')),position:53}).runAt).toBeNull()
    expect(planCommercialWait({now:Date.parse(date(28,'01:00')),startedAt:date(27,'01:00'),lastCustomerAt:date(27,'01:00'),position:4,remainingWaits:1}).runAt).toBeNull()
  })
  it('fails closed for unavailable or future customer timestamps',()=>{
    expect(plan('11:00',{lastCustomerAt:'invalid'}).runAt).toBeNull()
    expect(plan('11:00',{lastCustomerAt:date(27,'12:00')}).runAt).toBeNull()
  })
})
