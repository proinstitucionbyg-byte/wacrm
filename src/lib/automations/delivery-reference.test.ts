import {describe,it,expect,vi} from 'vitest';
import {deliveryReferenceAliases,readDeliveryReference} from './delivery-reference';

function database(data:unknown,error:unknown=null){
  const query={select:vi.fn(),eq:vi.fn(),limit:vi.fn(),maybeSingle:vi.fn(),then:vi.fn()};
  query.select.mockReturnValue(query);query.eq.mockReturnValue(query);query.limit.mockReturnValue(query);
  query.maybeSingle.mockResolvedValue({data,error});query.then.mockImplementation(resolve=>resolve({data,error}));
  return {from:vi.fn(()=>query),query};
}
describe('stable session delivery references',()=>{
  const id='1209bcda-05e7-4ca6-965a-716363225abc',reference=`waweb-job:${id}`;
  it('reads the durable job after the temporary message ID has been replaced, within the same account and conversation',async()=>{
    const db=database({status:'delivered'});
    expect(await readDeliveryReference(db as never,'account','conversation',reference)).toEqual({status:'delivered',error:false});
    expect(db.from).toHaveBeenCalledWith('whatsapp_session_outbound_jobs');
    for(const pair of [['id',id],['account_id','account'],['conversation_id','conversation']])expect(db.query.eq).toHaveBeenCalledWith(...pair);
    const acknowledged=database([{id}]);expect(await deliveryReferenceAliases(acknowledged as never,'account','conversation','true_provider')).toEqual(['true_provider',reference]);
  });
  it('never promotes an accepted or uncertain session send to delivered, and fails closed on a missing job',async()=>{
    expect(await readDeliveryReference(database({status:'accepted'}) as never,'a','c',reference)).toEqual({status:'accepted',error:false});
    expect(await readDeliveryReference(database({status:'needs_review'}) as never,'a','c',reference)).toEqual({status:'failed',error:false});
    expect((await readDeliveryReference(database(null) as never,'a','c',reference)).error).toBe(true);
    await expect(deliveryReferenceAliases(database(null,{message:'unavailable'}) as never,'a','c','true_provider')).rejects.toThrow();
  });
});
