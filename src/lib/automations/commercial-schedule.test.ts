import {describe,it,expect} from 'vitest'
import {planCommercialWait,planSavedCourseWait} from './commercial-schedule'
const date=(day:number,time:string)=>`2026-10-${day}T${time}:00-05:00`
const plan=(hour:string,opts:Partial<Parameters<typeof planCommercialWait>[0]>={})=>planCommercialWait({
  now:Date.parse(date(27,hour)),startedAt:date(27,'01:00'),lastCustomerAt:date(27,'01:00'),position:4,remainingWaits:15,...opts})
describe('Lima commercial scheduling',()=>{
  it('keeps the initial listening interval at night',()=>expect(plan('01:00',{position:2}).runAt).toBe('2026-10-27T06:02:00.000Z'))
  it.each([['01:02','08:00'],['06:00','08:00'],['07:00','08:00'],['08:00','08:20']])('resumes from %s at %s', (now,due)=>{
    expect(plan(now).runAt).toBe(new Date(date(27,due)).toISOString())
  })
  it('spaces the noon band by 20-25 minutes',()=>{
    expect(plan('12:00').runAt).toBe(new Date(date(27,'12:20')).toISOString())
    expect(plan('12:00',{position:7}).runAt).toBe(new Date(date(27,'12:25')).toISOString())
  })
  it('respects the afternoon rest',()=>expect(plan('14:20',{remainingWaits:5}).runAt).toBe(new Date(date(27,'17:00')).toISOString()))
  it('continues the afternoon band',()=>expect(plan('17:00').runAt).toBe(new Date(date(27,'17:20')).toISOString()))
  it('moves a late arrival to morning when all remaining blocks fit',()=>{
    expect(plan('23:00',{lastCustomerAt:date(27,'21:00'),startedAt:date(27,'21:00')}).runAt).toBe(new Date(date(28,'08:00')).toISOString())
  })
  it('keeps late evening within the evening band',()=>{
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
    expect(plan('12:00',{lastCustomerAt:'invalid'}).runAt).toBeNull()
    expect(plan('12:00',{lastCustomerAt:date(27,'13:00')}).runAt).toBeNull()
  })
})

describe('saved course waits',()=>{
const native=(now:string,extra={})=>planSavedCourseWait({now:Date.parse(date(27,now)),lastCustomerAt:date(27,'01:00'),waitMs:180000,initial:false,interactive:false,...extra})
it('keeps the initial wait overnight',()=>expect(native('01:00',{initial:true})).toBe(new Date(date(27,'01:03')).toISOString()))
it('answers requested material overnight',()=>expect(native('01:00',{interactive:true})).toBe(new Date(date(27,'01:03')).toISOString()))
it.each([['01:00','08:00'],['09:00','12:00'],['14:00','17:00'],['18:00','18:03']])('schedules silent leads from %s at %s',(now,due)=>expect(native(now)).toBe(new Date(date(27,due)).toISOString()))
it('defers after 23 until morning',()=>expect(native('23:00')).toBe(new Date(date(28,'08:00')).toISOString()))
})
