import{describe,it,expect,vi}from'vitest';import type{SupabaseClient}from'@supabase/supabase-js';import{claimAiReplyTurn}from'./reply-turn';
describe('AI reply burst coalescing',()=>{
 it('waits briefly and gives only one worker the durable latest-message turn',async()=>{
 let claimed=false;const wait=vi.fn(async()=>{});const rpc=vi.fn(async(name:string)=>name==='claim_ai_reply_turn'?(claimed?{data:[],error:null}:(claimed=true,{data:[{token:'one'}],error:null})):{data:true,error:null});
 const db={rpc}as unknown as SupabaseClient;const turns=await Promise.all([claimAiReplyTurn(db,'a','c',wait),claimAiReplyTurn(db,'a','c',wait),claimAiReplyTurn(db,'a','c',wait)]);
 expect(wait).toHaveBeenCalledWith(2500);expect(turns.filter(Boolean)).toHaveLength(1);expect(await turns.find(Boolean)!()).toBe(true);
 });
 it('stops stale generation when the latest turn changes and fails closed on database errors',async()=>{
 const rpc=vi.fn().mockResolvedValueOnce({data:[{token:'old'}],error:null}).mockResolvedValueOnce({data:false,error:null});
 const guard=await claimAiReplyTurn({rpc}as unknown as SupabaseClient,'a','c',async()=>{});expect(await guard!()).toBe(false);
 await expect(claimAiReplyTurn({rpc:async()=>({error:Error('offline')})}as unknown as SupabaseClient,'a','c',async()=>{})).rejects.toThrow('offline');
 });
});
