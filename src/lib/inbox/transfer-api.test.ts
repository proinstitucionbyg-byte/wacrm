import {beforeEach,describe,expect,it,vi} from 'vitest';
import {NextResponse} from 'next/server';
const mocks=vi.hoisted(()=>({permission:vi.fn(),rpc:vi.fn()}));
vi.mock('@/lib/auth/permissions',()=>({requirePermission:mocks.permission}));
vi.mock('@/lib/auth/account',()=>({toErrorResponse:(e:{status?:number})=>NextResponse.json({error:'denied'},{status:e.status??500})}));
import {POST} from '@/app/api/inbox/transfer/route';
const conversation='11111111-1111-4111-8111-111111111111',agent='22222222-2222-4222-8222-222222222222';
const request=(body:unknown)=>new Request('http://localhost',{method:'POST',body:JSON.stringify(body)});
beforeEach(()=>{vi.resetAllMocks();mocks.permission.mockResolvedValue({supabase:{rpc:mocks.rpc}});mocks.rpc.mockResolvedValue({data:{agent_id:agent},error:null});});
describe('derivacion directa sin aceptacion del receptor',()=>{
 it.each([true,false])('applies full_history=%s immediately through the protected function',async full_history=>{expect((await POST(request({conversation,agent,full_history}))).status).toBe(200);expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('transfer_inbox_conversation',{p_conversation:conversation,p_agent:agent,p_full_history:full_history});});
 it('checks sender permission before accessing the conversation',async()=>{mocks.permission.mockRejectedValue({status:403});expect((await POST(request({conversation,agent,full_history:true}))).status).toBe(403);expect(mocks.rpc).not.toHaveBeenCalled();});
 it('does not allow recipients from another account or without inbox access',async()=>{mocks.rpc.mockResolvedValue({data:null,error:{code:'42501'}});expect((await POST(request({conversation,agent,full_history:false}))).status).toBe(403);});
 it('requires an explicit valid history selection',async()=>{expect((await POST(request({conversation,agent,full_history:'yes'}))).status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled();});
});
