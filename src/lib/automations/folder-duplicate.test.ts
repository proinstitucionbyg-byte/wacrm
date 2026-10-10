import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ role:vi.fn(), calls:[] as {table:string;op:string;payload:unknown}[], failSteps:false }));
vi.mock('@/lib/auth/account', () => ({ requireRole:h.role, toErrorResponse:()=>new Response(null,{status:403}) }));
vi.mock('@/lib/automations/admin-client', () => ({ supabaseAdmin:()=>({from:(table:string)=>{
  let op='select'; let payload:unknown;
  const result=()=>{
    if(op==='delete') return {data:null,error:null};
    if(table==='automation_folders') return {data:op==='insert'?{id:'copy-folder',parent_id:'parent'}:{id:'source-folder',name:'PROMOS',parent_id:'parent'},error:null};
    if(table==='automations') return {data:op==='insert'?{id:'copy-auto'}:[{id:'source-auto',account_id:'account',folder_id:'source-folder',name:'NUTRICION',is_active:true}],error:null};
    if(op==='insert') return {data:null,error:h.failSteps?{message:'steps failed'}:null};
    return {data:[{id:'root',parent_step_id:null,branch:null,step_type:'condition',step_config:{},position:0},{id:'child',parent_step_id:'root',branch:'yes',step_type:'send_media',step_config:{media_url:'audio.ogg'},position:0}],error:null};
  };
  const chain={select:vi.fn(()=>chain),eq:vi.fn(()=>chain),in:vi.fn(()=>chain),single:vi.fn(async()=>result()),maybeSingle:vi.fn(async()=>result()),
    insert:vi.fn((value:unknown)=>{op='insert';payload=value;h.calls.push({table,op,payload});return chain}),
    delete:vi.fn(()=>{op='delete';h.calls.push({table,op,payload:null});return chain}),
    then:(resolve:(value:unknown)=>unknown)=>Promise.resolve(result()).then(resolve)};
  return chain;
}}) }));
import { POST } from '@/app/api/automations/folders/duplicate/route';
beforeEach(()=>{vi.clearAllMocks();h.calls=[];h.failSteps=false;h.role.mockResolvedValue({accountId:'account'});});
const request=()=>new Request('http://localhost',{method:'POST',body:JSON.stringify({id:'source-folder'})});
describe('duplicating automation folders',()=>{
  it('keeps the parent folder, copies steps and remaps branches, leaving copies inactive',async()=>{
    expect((await POST(request())).status).toBe(201);
    expect(h.calls.find(call=>call.table==='automation_folders'&&call.op==='insert')?.payload).toMatchObject({parent_id:'parent'});
    expect(h.calls.find(call=>call.table==='automations'&&call.op==='insert')?.payload).toMatchObject({folder_id:'copy-folder',is_active:false});
    const rows=h.calls.find(call=>call.table==='automation_steps'&&call.op==='insert')?.payload as {id:string;parent_step_id:string;automation_id:string}[];
    expect(rows).toHaveLength(2);expect(rows[1].parent_step_id).toBe(rows[0].id);expect(rows[0].id).not.toBe('root');expect(rows[0].automation_id).toBe('copy-auto');
  });
  it('cleans only the new copy if copying steps fails',async()=>{
    h.failSteps=true;expect((await POST(request())).status).toBe(500);
    expect(h.calls.filter(call=>call.op==='delete').map(call=>call.table)).toEqual(['automations','automation_folders']);
  });
  it('blocks a caller without the required role',async()=>{
    h.role.mockRejectedValue(new Error('denied'));expect((await POST(request())).status).toBe(403);expect(h.calls).toEqual([]);
  });
});
