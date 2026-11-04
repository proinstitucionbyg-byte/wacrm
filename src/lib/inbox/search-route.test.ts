import {beforeEach,describe,expect,it,vi} from 'vitest';
const h=vi.hoisted(()=>({permission:vi.fn(),from:vi.fn(),filters:[] as unknown[][],rows:[] as Record<string,unknown>[],hidden:[] as {message_id:string}[]}));
vi.mock('@/lib/auth/permissions',()=>({requirePermission:h.permission}));
vi.mock('@/lib/auth/account',()=>({toErrorResponse:()=>new Response(null,{status:403})}));
import {GET} from '@/app/api/inbox/search/route';
const id='00000000-0000-4000-8000-000000000001';
beforeEach(()=>{vi.resetAllMocks();h.filters=[];h.hidden=[];h.rows=[{id:'message',conversation_id:id,content_text:'Número 987 020 644',created_at:'2026-11-04T10:00:00Z',sender_type:'customer'}];
 h.from.mockImplementation((table:string)=>{const q={select:()=>q,eq:(...args:unknown[])=>{h.filters.push(args);return q;},ilike:(...args:unknown[])=>{h.filters.push(args);return q;},order:()=>q,range:async()=>({data:h.rows,error:null}),in:async()=>({data:h.hidden,error:null})};return q;});
 h.permission.mockResolvedValue({accountId:'account',supabase:{from:h.from}});
});
const request=(params:string)=>new Request('http://localhost/api/inbox/search?'+params);
describe('permission scoped Inbox history search',()=>{
 it('checks permission before reading content',async()=>{h.permission.mockRejectedValue(Error('denied'));expect((await GET(request('q=hola'))).status).toBe(403);expect(h.from).not.toHaveBeenCalled();});
 it('searches formatted phone text in an exact conversation and account',async()=>{
  const response=await GET(request(new URLSearchParams({q:'9870 2064 4',conversation:id}).toString()));expect((await response.json()).matches).toHaveLength(1);
  expect(h.filters).toContainEqual(['conversation.account_id','account']);expect(h.filters).toContainEqual(['conversation_id',id]);
 });
 it('does not reveal messages hidden by the current user',async()=>{h.hidden=[{message_id:'message'}];expect((await(await GET(request('q=987020644'))).json()).matches).toEqual([]);});
 it('escapes wildcard text instead of matching the full database',async()=>{await GET(request('q='+encodeURIComponent('50%_off')));expect(h.filters).toContainEqual(['content_text','%50\\%\\_off%']);});
 it.each(['q=x','q=hola&conversation=invalid','q=hola&offset=-1','q=hola&offset=1.5'])('rejects invalid search parameters',async params=>{expect((await GET(request(params))).status).toBe(400);expect(h.from).not.toHaveBeenCalled();});
});
