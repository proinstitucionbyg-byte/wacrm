import { beforeEach, describe, expect, it, vi } from 'vitest';
const h=vi.hoisted(()=>({permission:vi.fn(),from:vi.fn(),rpc:vi.fn(),rows:[] as {id:string}[]}));
vi.mock('@/lib/auth/permissions',()=>({requirePermission:h.permission}));
vi.mock('@/lib/auth/account',()=>({toErrorResponse:()=>new Response(null,{status:403})}));
import {POST} from '@/app/api/inbox/conversations/clear/route';
const a='00000000-0000-4000-8000-000000000001',b='00000000-0000-4000-8000-000000000002';
const request=(body:unknown)=>new Request('http://localhost/api/inbox/conversations/clear',{method:'POST',body:JSON.stringify(body)});
beforeEach(()=>{
 vi.resetAllMocks();h.rows=[{id:a},{id:b}];
 const query={select:()=>query,eq:()=>query,in:async()=>({data:h.rows,error:null})};h.from.mockReturnValue(query);
 h.rpc.mockResolvedValue({error:null});h.permission.mockResolvedValue({accountId:'account',supabase:{from:h.from,rpc:h.rpc}});
});
describe('CEO delegated bulk conversation cleanup',()=>{
 it('checks permission before reading or clearing',async()=>{h.permission.mockRejectedValue(Error('denied'));expect((await POST(request({conversations:[a],confirmed:true}))).status).toBe(403);expect(h.rpc).not.toHaveBeenCalled();});
 it('clears every selected conversation once using the existing recoverable RPC',async()=>{
  const response=await POST(request({conversations:[a,b,a],confirmed:true}));expect(await response.json()).toMatchObject({cleared:[a,b],failed:[],scope:'team_inbox',recoverable:true});
  expect(h.permission).toHaveBeenCalledWith('inbox_management','conversations');expect(h.rpc).toHaveBeenCalledTimes(2);
  expect(h.rpc).toHaveBeenCalledWith('set_inbox_cleared',{p_conversation:b,p_clear:true});
 });
 it('reports partial failures rather than pretending all chats were cleared',async()=>{
  h.rpc.mockResolvedValueOnce({error:null}).mockResolvedValueOnce({error:Error('failed')});
  const response=await POST(request({conversations:[a,b],confirmed:true}));expect(response.status).toBe(207);expect(await response.json()).toMatchObject({cleared:[a],failed:[b]});
 });
 it('rejects mixed or inaccessible selections before mutating any chat',async()=>{h.rows=[{id:a}];expect((await POST(request({conversations:[a,b],confirmed:true}))).status).toBe(403);expect(h.rpc).not.toHaveBeenCalled();});
 it.each([{}, {conversations:[a]}, {conversations:[],confirmed:true},{conversations:['invalid'],confirmed:true},{conversations:Array(101).fill(a),confirmed:true}])('rejects malformed or unconfirmed bulk cleanup',async body=>{expect((await POST(request(body))).status).toBe(400);expect(h.rpc).not.toHaveBeenCalled();});
});
