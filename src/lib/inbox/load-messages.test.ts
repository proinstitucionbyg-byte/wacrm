import { describe, expect, it, vi } from 'vitest';
import { loadConversationMessages } from './load-messages';
function setup(total:number,error:unknown=null) {
  const rows=Array.from({length:total},(_,i)=>({id:String(total-i)}));
  const chain={select:vi.fn(),eq:vi.fn(),order:vi.fn(),range:vi.fn(async (start:number,end:number)=>({data:rows.slice(start,end+1),error}))};
  chain.select.mockReturnValue(chain);chain.eq.mockReturnValue(chain);chain.order.mockReturnValue(chain);
  return {db:{from:vi.fn(()=>chain)},chain};
}
describe('complete conversation history',()=>{
  it('loads beyond the default API page and restores chronological order',async()=>{
    const {db,chain}=setup(758);const rows=await loadConversationMessages(db as never,'chat',()=>false);
    expect(rows).toHaveLength(758);expect(rows[0].id).toBe('1');expect(rows.at(-1)?.id).toBe('758');expect(chain.range).toHaveBeenCalledTimes(8);
    expect(chain.eq).toHaveBeenCalledWith('conversation_id','chat');
  });
  it('does not report an incomplete fetch as successful',async()=>{
    const {db}=setup(0,{message:'denied'});await expect(loadConversationMessages(db as never,'chat',()=>false)).rejects.toEqual({message:'denied'});
  });
  it('stops when the user changes conversations',async()=>{
    const {db,chain}=setup(758);let calls=0;await loadConversationMessages(db as never,'chat',()=>calls++>0);expect(chain.range).toHaveBeenCalledOnce();
  });
});
