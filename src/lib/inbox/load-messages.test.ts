import { describe, expect, it, vi } from 'vitest';
import {
  loadConversationMessages,
  loadRecentConversationMessages,
  RECENT_MESSAGE_LIMIT,
} from './load-messages';
function setup(total:number,error:unknown=null,hiddenIds:string[]=[],hiddenError:unknown=null) {
  const rows=Array.from({length:total},(_,i)=>({id:String(total-i)}));
  const chain={select:vi.fn(),eq:vi.fn(),order:vi.fn(),range:vi.fn(async (start:number,end:number)=>({data:rows.slice(start,end+1),error}))};
  chain.select.mockReturnValue(chain);chain.eq.mockReturnValue(chain);chain.order.mockReturnValue(chain);
  const hidden={select:vi.fn(),in:vi.fn(async()=>({data:hiddenIds.map(message_id=>({message_id})),error:hiddenError}))};hidden.select.mockReturnValue(hidden);
  return {db:{from:vi.fn((table:string)=>table==='inbox_hidden_messages'?hidden:chain)},chain};
}
describe('complete conversation history',()=>{
  it('loads only the recent window for a responsive initial thread',async()=>{
    const {db,chain}=setup(758);
    const page=await loadRecentConversationMessages(db as never,'chat',()=>false);
    expect(page.messages).toHaveLength(RECENT_MESSAGE_LIMIT);
    expect(page.messages[0].id).toBe(String(758 - RECENT_MESSAGE_LIMIT + 1));
    expect(page.messages.at(-1)?.id).toBe('758');
    expect(page.hasMore).toBe(true);
    expect(chain.range).toHaveBeenCalledOnce();
  });
  it('omits only this viewer’s hidden messages, preserving complete pagination',async()=>{
    const {db}=setup(203,null,['2','100','201']);const rows=await loadConversationMessages(db as never,'chat',()=>false);
    expect(rows).toHaveLength(200);expect(rows.map(r=>r.id)).not.toContain('100');
  });
  it('does not redisplay hidden content if the visibility lookup fails',async()=>{
    const {db}=setup(3,null,[],new Error('hidden unavailable'));await expect(loadConversationMessages(db as never,'chat',()=>false)).rejects.toThrow('hidden unavailable');
  });
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
