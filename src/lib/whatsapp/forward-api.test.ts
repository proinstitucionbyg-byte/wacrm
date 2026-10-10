import {beforeEach,describe,expect,it,vi} from 'vitest';
import {NextResponse} from 'next/server';
const mocks=vi.hoisted(()=>({permission:vi.fn(),from:vi.fn(),send:vi.fn()}));
vi.mock('@/lib/auth/permissions',()=>({requirePermission:mocks.permission}));
vi.mock('@/lib/auth/account',()=>({toErrorResponse:(e:{status?:number})=>NextResponse.json({error:'denied'},{status:e.status??500})}));
vi.mock('@/lib/rate-limit',()=>({checkRateLimit:()=>({success:true}),rateLimitResponse:vi.fn(),RATE_LIMITS:{send:{}}}));
vi.mock('@/lib/whatsapp/send-message',()=>({sendMessageToConversation:mocks.send,SendMessageError:class extends Error{status=400;}}));
import {POST} from '@/app/api/whatsapp/forward/route';
const messageId='11111111-1111-4111-8111-111111111111',conversationId='22222222-2222-4222-8222-222222222222';
let original:Record<string,unknown>,inbound:string|null;
beforeEach(()=>{
 vi.resetAllMocks();original={content_type:'text',content_text:'LINEA 1\n\nLINEA 2',reply_to_message_id:'OLD-CONVERSATION',created_at:'2020-01-01'};inbound=new Date(Date.now()-1000).toISOString();
 mocks.permission.mockResolvedValue({accountId:'account',userId:'adviser',supabase:{from:mocks.from}});
 mocks.from.mockImplementation((table:string)=>{const chain:Record<string,unknown>={};for(const method of ['select','eq','order','limit'])chain[method]=vi.fn(()=>chain);chain.single=vi.fn(async()=>({data:original,error:null}));chain.maybeSingle=vi.fn(async()=>({data:table==='conversations'?{id:conversationId,contact:{channel:'whatsapp'}}:inbound?{created_at:inbound}:null,error:null}));return chain;});
 mocks.send.mockResolvedValue({messageId:'sent',whatsappMessageId:'meta'});
});
const request=()=>new Request('http://localhost',{method:'POST',body:JSON.stringify({messageId,conversationId})});
describe('reenviar desde cualquier fecha al destino con ventana activa',()=>{
 it('preserves line breaks from an old original and does not quote the other conversation',async()=>{expect((await POST(request())).status).toBe(200);expect(mocks.send.mock.calls[0][2]).toMatchObject({senderId:'adviser',conversationId,contentText:original.content_text,messageType:'text'});expect(mocks.send.mock.calls[0][2]).not.toHaveProperty('replyToMessageId');});
 it.each(['image','audio','video','document'])('preserves %s and the original media address',async type=>{original={content_type:type,media_url:'/api/whatsapp/media/123',content_text:'ARCHIVO'};expect((await POST(request())).status).toBe(200);expect(mocks.send.mock.calls[0][2]).toMatchObject({messageType:type,mediaUrl:'/api/whatsapp/media/123'});});
 it.each([null,'2020-01-01T00:00:00Z','invalid'])('blocks destinations without a valid recent inbound message: %s',async date=>{inbound=date;expect((await POST(request())).status).toBe(400);expect(mocks.send).not.toHaveBeenCalled();});
 it('forwards a received button reply as text when no outbound button payload exists',async()=>{original={content_type:'interactive',content_text:'MALLA'};expect((await POST(request())).status).toBe(200);expect(mocks.send.mock.calls[0][2].messageType).toBe('text');});
 it('checks access before querying or sending',async()=>{mocks.permission.mockRejectedValue({status:403});expect((await POST(request())).status).toBe(403);expect(mocks.from).not.toHaveBeenCalled();expect(mocks.send).not.toHaveBeenCalled();});
});
