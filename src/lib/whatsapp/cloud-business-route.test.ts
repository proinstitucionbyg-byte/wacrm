import {describe,it,expect,vi} from 'vitest'
import {cloudBusinessRouteEnabled,prepareCloudBusinessRoute,CLOUD_BUSINESS_OPENING_DELAY_MS} from './cloud-business-route'
const args={accountId:'account',conversationId:'chat',messageId:'real-cloud-source'}
describe('owner approved Cloud to Business continuation',()=>{
 it('retains the three minute delay',()=>expect(CLOUD_BUSINESS_OPENING_DELAY_MS).toBe(180000))
 it.each([{}, {enabled:true}, {enabled:false,automatic_sales_handoff:true}])('requires the explicit route flag %j',async data=>{
  const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data,error:null})}
  expect(await cloudBusinessRouteEnabled({from:()=>q} as never,'account')).toBe(false)
 })
 it('allows the configured owner route',async()=>{
  const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{enabled:true,automatic_sales_handoff:true},error:null})}
  expect(await cloudBusinessRouteEnabled({from:()=>q} as never,'account')).toBe(true)
 })
 it('binds the original source without sending a new welcome',async()=>{
  const rpc=vi.fn(async()=>({data:{ready:true,line_key:'configured-business'},error:null}))
  await prepareCloudBusinessRoute({rpc} as never,args)
  expect(rpc).toHaveBeenCalledExactlyOnceWith('prepare_cloud_business_route',{p_account_id:'account',p_conversation_id:'chat',p_provider_id:'real-cloud-source'})
 })
 it.each([{data:{ready:false,reason:'no_ready_line'},error:null},{data:null,error:{message:'failure'}}])('does not fall back to Cloud for %j',async result=>{
  await expect(prepareCloudBusinessRoute({rpc:async()=>result} as never,args)).rejects.toThrow('no se enviará por API')
 })
})
