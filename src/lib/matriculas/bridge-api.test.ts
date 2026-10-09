import { beforeEach,describe,expect,it,vi } from 'vitest';
import { NextResponse } from 'next/server';
const mocks=vi.hoisted(()=>({key:vi.fn(),role:vi.fn(),from:vi.fn(),select:vi.fn(),eq:vi.fn(),not:vi.fn(),or:vi.fn(),order:vi.fn(),limit:vi.fn(),update:vi.fn(),in:vi.fn(),single:vi.fn(),media:vi.fn(),download:vi.fn()}));
vi.mock('@/lib/auth/api-context',()=>({requireApiKey:mocks.key}));
vi.mock('@/lib/auth/account',()=>({requireRole:mocks.role,toErrorResponse:(e:{status?:number})=>NextResponse.json({error:'denied'},{status:e.status??500})}));
vi.mock('@/lib/auth/permissions',()=>({requirePermission:mocks.role}));
vi.mock('@/lib/flows/admin-client',()=>({supabaseAdmin:()=>({from:mocks.from})}));
vi.mock('@/lib/whatsapp/meta-api',()=>({getMediaUrl:mocks.media,downloadMedia:mocks.download}));
vi.mock('@/lib/whatsapp/encryption',()=>({decrypt:()=> 'private-token'}));
import { POST as claim } from '@/app/api/v1/enrollments/claim/route';
import { POST as result } from '@/app/api/v1/enrollments/[id]/result/route';
import { GET as file } from '@/app/api/v1/enrollments/[id]/files/[messageId]/route';
import { POST as submit } from '@/app/api/enrollments/[id]/submit/route';
const id='11111111-1111-4111-8111-111111111111';
const request=(body:unknown)=>new Request('http://localhost',{method:'POST',headers:{'x-enrollment-lease':'lease'},body:JSON.stringify(body)});
const context=()=>({params:Promise.resolve({id,messageId:id})});
const valid={full_name:'LUIS BRAYAN',document_type:'DNI',document_number:'12345678',phone1:'51937467119',email:'x@gmail.com',course:'NUTRICION Y DIETETICA',start_date:'2026-10-06',promotion_id:'PROMO 1',payment_date:'2026-10-05',amount:'19.90',payment_method:'YAPE',identity_message_ids:[id],identity_confirmed:true,offer_confirmed:true,prices:[19.9,79.9,79.9,79.9,79.9,79.9]};
beforeEach(()=>{
  vi.resetAllMocks();
  const chain={select:mocks.select,eq:mocks.eq,not:mocks.not,or:mocks.or,order:mocks.order,limit:mocks.limit,update:mocks.update,in:mocks.in,maybeSingle:mocks.single};
  for(const fn of [mocks.from,mocks.select,mocks.eq,mocks.not,mocks.or,mocks.order,mocks.update,mocks.in])fn.mockReturnValue(chain);
  const ctx={accountId:'account-a',userId:'agent-a',supabase:{from:mocks.from}};
  mocks.key.mockResolvedValue(ctx);mocks.role.mockResolvedValue(ctx);mocks.single.mockResolvedValue({data:null,error:null});mocks.limit.mockResolvedValue({data:[],error:null});
});
describe('authenticated Google enrollment bridge',()=>{
  it('requires the dedicated scope before touching the queue',async()=>{
    expect((await claim(request({}))).status).toBe(200);
    expect(mocks.key).toHaveBeenCalledWith(expect.any(Request),'enrollments:sync');expect(mocks.eq).toHaveBeenCalledWith('account_id','account-a');
    expect(mocks.not).toHaveBeenCalledWith('sales_adviser','is',null);
  });
  it('never claims a job with an unvalidated receipt',async()=>{
    mocks.limit.mockResolvedValue({data:[{id,version:1,review_id:id,status:'ready',data:valid,sales_adviser:'ASHLEY'}],error:null});
    mocks.single.mockResolvedValue({data:{status:'pending'},error:null});
    const response=await claim(request({}));expect(await response.json()).toEqual({data:{job:null}});expect(mocks.update).not.toHaveBeenCalled();
  });
  it('claims with a version check and returns only its assigned evidence IDs',async()=>{
    mocks.limit.mockResolvedValue({data:[{id,version:1,review_id:id,status:'ready',data:{...valid,sales_adviser:'FORGED'},sales_adviser:'ASHLEY'}],error:null});
    mocks.single.mockResolvedValueOnce({data:{status:'validated',message_id:'voucher'},error:null}).mockResolvedValueOnce({data:{id,lease_token:'lease',data:valid,sales_adviser:'ASHLEY'},error:null});
    const response=await claim(request({}));const job=(await response.json()).data.job;
    expect(job.voucher_message_id).toBe('voucher');expect(job.sales_adviser).toBe('ASHLEY');expect(job.data.sales_adviser).toBeUndefined();
    expect(mocks.eq).toHaveBeenCalledWith('version',1);expect(mocks.update.mock.calls[0][0].status).toBe('processing');
  });
  it('does not guess attribution for a historical receipt without a snapshot',async()=>{
    mocks.limit.mockResolvedValue({data:[{id,version:1,review_id:id,status:'ready',data:valid,sales_adviser:null}],error:null});
    expect((await (await claim(request({}))).json()).data.job).toBeNull();expect(mocks.update).not.toHaveBeenCalled();
  });
  it('rejects result callbacks with another lease',async()=>{
    mocks.single.mockResolvedValue({data:{status:'processing',lease_token:'other'},error:null});
    expect((await result(request({status:'error',lease_token:'lease',error:'REVISAR'}),context())).status).toBe(409);expect(mocks.update).not.toHaveBeenCalled();
  });
  it('rejects output URLs outside Google Drive',async()=>{
    expect((await result(request({status:'registered',lease_token:'lease',registered_number:'1',student_folder_url:'https://other.example/folder'}),context())).status).toBe(400);expect(mocks.from).not.toHaveBeenCalled();
  });
  it('handles a repeated successful callback without changing the registration',async()=>{
    const url='https://drive.google.com/drive/folders/folder';
    mocks.single.mockResolvedValue({data:{status:'registered',lease_token:'lease',registered_number:'1',student_folder_url:url},error:null});
    expect((await result(request({status:'registered',lease_token:'lease',registered_number:'1',student_folder_url:url}),context())).status).toBe(200);expect(mocks.update).not.toHaveBeenCalled();
  });
  it('does not expose images from a job without the matching lease',async()=>{
    mocks.single.mockResolvedValue({data:{status:'processing',lease_token:'other'},error:null});
    expect((await file(request({}),context())).status).toBe(404);expect(mocks.media).not.toHaveBeenCalled();
  });
  it('does not expose unselected conversation images',async()=>{
    mocks.single.mockResolvedValueOnce({data:{status:'processing',lease_token:'lease',review_id:id,data:{identity_message_ids:[]}},error:null}).mockResolvedValueOnce({data:{status:'validated',message_id:'different'},error:null});
    expect((await file(request({}),context())).status).toBe(404);expect(mocks.media).not.toHaveBeenCalled();
  });
  it('refuses submission while identity data is missing',async()=>{
    mocks.single.mockResolvedValue({data:{status:'collecting',data:{}},error:null});
    expect((await submit(request({version:1}),context())).status).toBe(400);expect(mocks.update).not.toHaveBeenCalled();
  });
  it('checks the payment again before allowing Google submission',async()=>{
    mocks.single.mockResolvedValueOnce({data:{status:'collecting',data:valid,review_id:id},error:null}).mockResolvedValueOnce({data:{status:'pending'},error:null});
    expect((await submit(request({version:1}),context())).status).toBe(409);expect(mocks.update).not.toHaveBeenCalled();
  });
});
