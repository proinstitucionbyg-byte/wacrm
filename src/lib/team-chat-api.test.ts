import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
const mocks=vi.hoisted(()=>({role:vi.fn(),from:vi.fn(),rpc:vi.fn(),select:vi.fn(),eq:vi.fn(),insert:vi.fn(),update:vi.fn(),single:vi.fn(),maybeSingle:vi.fn(),is:vi.fn(),lte:vi.fn()}));
vi.mock('@/lib/auth/account',()=>({requireRole:mocks.role,toErrorResponse:(e:{status?:number})=>NextResponse.json({error:'denied'},{status:e.status??500})}));
import { POST as createThread } from '@/app/api/team-chat/route';
import { POST as send } from '@/app/api/team-chat/[id]/messages/route';
import { POST as read } from '@/app/api/team-chat/[id]/read/route';
const id='11111111-1111-4111-8111-111111111111';
const messageId='22222222-2222-4222-8222-222222222222';
const request=(body:unknown)=>new Request('http://localhost',{method:'POST',body:JSON.stringify(body)});
const context=()=>({params:Promise.resolve({id})});
beforeEach(()=>{
 vi.resetAllMocks();
 const chain={select:mocks.select,eq:mocks.eq,insert:mocks.insert,update:mocks.update,single:mocks.single,maybeSingle:mocks.maybeSingle,is:mocks.is,lte:mocks.lte};
 for(const fn of [mocks.from,mocks.select,mocks.eq,mocks.insert,mocks.update,mocks.is])fn.mockReturnValue(chain);
 mocks.role.mockResolvedValue({accountId:'account-a',userId:'user-a',supabase:{from:mocks.from,rpc:mocks.rpc}});
 mocks.maybeSingle.mockResolvedValue({data:{id},error:null});
 mocks.single.mockResolvedValue({data:{id:messageId,body:'Hola'},error:null});
 mocks.lte.mockResolvedValue({error:null});
});
describe('team chat API boundaries',()=>{
 it('requires staff authentication before database access',async()=>{
  mocks.role.mockRejectedValue({status:403});
  expect((await send(request({id:messageId,body:'Hola'}),context())).status).toBe(403);
  expect(mocks.from).not.toHaveBeenCalled();
 });
 it('rejects malformed messages without database access',async()=>{
  expect((await send(request({id:'invalid',body:'Hola'}),context())).status).toBe(400);
  expect(mocks.from).not.toHaveBeenCalled();
 });
 it('does not send to a thread invisible to this member',async()=>{
  mocks.maybeSingle.mockResolvedValue({data:null,error:null});
  expect((await send(request({id:messageId,body:'Hola'}),context())).status).toBe(404);
  expect(mocks.insert).not.toHaveBeenCalled();
 });
 it('sets sender and account on the server and preserves line breaks',async()=>{
  expect((await send(request({id:messageId,body:'Hola\r\n  Segunda linea',sender_id:'forged',account_id:'forged'}),context())).status).toBe(201);
  expect(mocks.insert).toHaveBeenCalledWith({id:messageId,body:'Hola\n  Segunda linea',thread_id:id,account_id:'account-a',sender_id:'user-a'});
 });
 it('handles the same successful send retry without a second message',async()=>{
  mocks.single.mockResolvedValue({data:null,error:{code:'23505'}});
  mocks.maybeSingle.mockResolvedValueOnce({data:{id},error:null}).mockResolvedValueOnce({data:{id:messageId,body:'Hola'},error:null});
  expect((await send(request({id:messageId,body:'Hola'}),context())).status).toBe(200);
  expect(mocks.eq).toHaveBeenCalledWith('sender_id','user-a');
 });
 it('rejects reuse of a message ID with changed content',async()=>{
  mocks.single.mockResolvedValue({data:null,error:{code:'23505'}});
  mocks.maybeSingle.mockResolvedValueOnce({data:{id},error:null}).mockResolvedValueOnce({data:{body:'OLD'},error:null});
  expect((await send(request({id:messageId,body:'NEW'}),context())).status).toBe(409);
 });
 it('rejects future read timestamps',async()=>{
  expect((await read(request({through:new Date(Date.now()+60000).toISOString()}),context())).status).toBe(400);
  expect(mocks.update).not.toHaveBeenCalled();
 });
 it('marks only own notifications delivered through the observed timestamp',async()=>{
  const through='2026-01-01T10:00:00.000Z';
  expect((await read(request({through}),context())).status).toBe(200);
  expect(mocks.eq).toHaveBeenCalledWith('user_id','user-a');
  expect(mocks.eq).toHaveBeenCalledWith('team_thread_id',id);
  expect(mocks.lte).toHaveBeenCalledWith('created_at',through);
 });
 it('lets the database reject cross-account participants',async()=>{
  mocks.rpc.mockResolvedValue({data:null,error:{code:'42501'}});
  expect((await createThread(request({members:[id]}))).status).toBe(403);
  expect(mocks.rpc).toHaveBeenCalledWith('create_team_thread',{target_members:[id],thread_title:null});
 });
});
