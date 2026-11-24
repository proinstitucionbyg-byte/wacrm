import {beforeEach,expect,it,vi} from 'vitest';
const h=vi.hoisted(()=>({permission:vi.fn(),eq:vi.fn(),upload:vi.fn(),insert:vi.fn(),remove:vi.fn(),draft:{id:'draft',review_id:'review',version:3,status:'collecting'}}));
vi.mock('@/lib/auth/permissions',()=>({requirePermission:h.permission}));
vi.mock('@/lib/auth/account',()=>({toErrorResponse:(e:{status?:number})=>Response.json({error:'denied'},{status:e.status||500})}));
vi.mock('@/lib/flows/admin-client',()=>({supabaseAdmin:()=>({from:()=>({insert:h.insert}),storage:{from:()=>({upload:h.upload,remove:h.remove})}})}));
vi.mock('@/lib/matriculas/declaration-image',()=>({declarationImage:()=>new Response(new Uint8Array([137,80,78,71]))}));
import {POST} from './route';
const data={full_name:'ESTUDIANTE DE PRUEBA',document_type:'DNI',document_number:'12345678',email:'prueba@example.com'};
function request(overrides:Record<string,string>={}){const form=new FormData();for(const [k,v] of Object.entries({version:'3',kind:'confirmation',source:'call',phone:'51987020644',confirmed:'true',data:JSON.stringify(data),...overrides}))form.set(k,v);return new Request('https://crm.test',{method:'POST',body:form});}
beforeEach(()=>{vi.clearAllMocks();h.draft={id:'draft',review_id:'review',version:3,status:'collecting'};const q={select:()=>q,eq:h.eq,maybeSingle:async()=>({data:h.draft,error:null})};h.eq.mockReturnValue(q);h.permission.mockResolvedValue({accountId:'account',userId:'actor',supabase:{from:()=>q}});h.upload.mockResolvedValue({error:null});h.insert.mockResolvedValue({error:null});h.remove.mockResolvedValue({error:null});});
const ctx={params:Promise.resolve({id:'draft'})};
it('checks permission and version before creating evidence',async()=>{
 h.permission.mockRejectedValueOnce({status:403});expect((await POST(request(),ctx)).status).toBe(403);expect(h.upload).not.toHaveBeenCalled();
 expect((await POST(request({version:'2'}),ctx)).status).toBe(409);expect(h.upload).not.toHaveBeenCalled();
});
it('rejects registered drafts and unconfirmed manual data',async()=>{
 h.draft.status='registered';expect((await POST(request(),ctx)).status).toBe(409);h.draft.status='collecting';
 expect((await POST(request({confirmed:'false'}),ctx)).status).toBe(400);expect(h.insert).not.toHaveBeenCalled();
});
it('creates private attributed evidence without pretending the student wrote a message',async()=>{
 const response=await POST(request(),ctx);expect(response.status).toBe(201);
 expect(h.eq).toHaveBeenCalledWith('account_id','account');
 const row=h.insert.mock.calls[0][0];expect(row).toMatchObject({account_id:'account',review_id:'review',uploaded_by:'actor',kind:'declaration',image_analysis:{category:'staff_confirmed_identity',recorded_by:'actor',source:'call',source_phone:'51987020644',fields:data}});
 expect(row.storage_path).toMatch(/^account\/manual\/review\//);expect((await response.json()).evidence.url).toMatch(/^\/api\/enrollments\/uploads\//);
});
it('cleans up only its new object if catalog insertion fails',async()=>{
 h.insert.mockResolvedValueOnce({error:new Error('write failed')});expect((await POST(request(),ctx)).status).toBe(500);expect(h.remove).toHaveBeenCalledWith([h.upload.mock.calls[0][0]]);
});
