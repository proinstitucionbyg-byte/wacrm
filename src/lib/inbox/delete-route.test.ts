import {beforeEach,describe,expect,it,vi} from 'vitest';
const h=vi.hoisted(()=>({permission:vi.fn(),from:vi.fn(),select:vi.fn(),ids:vi.fn(),upsert:vi.fn()}));
vi.mock('@/lib/auth/permissions',()=>({requirePermission:h.permission}));
vi.mock('@/lib/auth/account',()=>({toErrorResponse:()=>new Response(null,{status:403})}));
import {DELETE} from '@/app/api/whatsapp/delete/route';
const id='00000000-0000-4000-8000-000000000001';
const request=(input:unknown)=>new Request('http://localhost/api/whatsapp/delete',{method:'DELETE',body:JSON.stringify(input)});
beforeEach(()=>{vi.resetAllMocks();h.permission.mockResolvedValue({userId:'owner',supabase:{from:h.from}});h.from.mockReturnValue({select:h.select,upsert:h.upsert});h.select.mockReturnValue({in:h.ids});h.ids.mockResolvedValue({data:[{id}],error:null});h.upsert.mockResolvedValue({error:null});});
describe('hide instead of erasing payment message evidence',()=>{
 it('rejects unauthorized callers before reading messages',async()=>{h.permission.mockRejectedValue(new Error('denied'));expect((await DELETE(request({messageIds:[id]}) as never)).status).toBe(403);expect(h.from).not.toHaveBeenCalled();});
 it.each([{}, {messageIds:[]},{messageIds:['invalid']},{messageIds:Array(101).fill(id)}])('rejects invalid selection',async input=>{expect((await DELETE(request(input) as never)).status).toBe(400);expect(h.from).not.toHaveBeenCalled();});
 it('requires access to every selected message',async()=>{h.ids.mockResolvedValue({data:[],error:null});expect((await DELETE(request({messageIds:[id]}) as never)).status).toBe(403);expect(h.upsert).not.toHaveBeenCalled();});
 it('stores only the caller’s hide markers and states only_me',async()=>{const result=await DELETE(request({messageIds:[id,id]}) as never);expect(result.status).toBe(200);expect(await result.json()).toMatchObject({scope:'only_me',hidden:[id]});expect(h.permission).toHaveBeenCalledWith('inbox_management','messages');expect(h.upsert).toHaveBeenCalledWith([{user_id:'owner',message_id:id}],{onConflict:'user_id,message_id',ignoreDuplicates:true});});
 it('does not report success after a write fails',async()=>{h.upsert.mockResolvedValue({error:new Error('failed')});expect((await DELETE(request({messageIds:[id]}) as never)).status).toBe(403);});
});
