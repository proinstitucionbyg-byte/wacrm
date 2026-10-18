import {beforeEach,describe,expect,it,vi} from 'vitest';
import {NextResponse} from 'next/server';
const h=vi.hoisted(()=>({permission:vi.fn(),rpc:vi.fn(),upload:vi.fn(),remove:vi.fn(),analyze:vi.fn(),visible:true}));
vi.mock('@/lib/auth/permissions',()=>({requirePermission:h.permission}));
vi.mock('@/lib/auth/account',()=>({toErrorResponse:(error:{status?:number})=>NextResponse.json({error:'Error'},{status:error.status??500})}));
vi.mock('@/lib/ai/analyze-image',()=>({analyzeInboundImage:h.analyze}));
vi.mock('@/lib/flows/admin-client',()=>({supabaseAdmin:()=>({rpc:h.rpc,storage:{from:()=>({upload:h.upload,remove:h.remove})}})}));
import {POST} from './route';
const uuid='11111111-1111-4111-8111-111111111111';
function request(voucher=true){const form=new FormData();form.set('data',JSON.stringify({full_name:'ESTUDIANTE PRUEBA'}));form.set('conversation_id',uuid);form.set('sales_agent_id',uuid);form.set('request_key',uuid);form.set('front',new File([new Uint8Array([1,2])],'dni.jpg',{type:'image/jpeg'}));if(voucher)form.set('voucher',new File([new Uint8Array([3,4])],'pago.jpg',{type:'image/jpeg'}));return new Request('http://localhost/api/enrollments/manual',{method:'POST',body:form});}
beforeEach(()=>{vi.clearAllMocks();h.visible=true;const chain={select:()=>chain,eq:()=>chain,maybeSingle:async()=>({data:h.visible?{id:uuid}:null,error:null})};h.permission.mockResolvedValue({accountId:uuid,userId:uuid,supabase:{from:()=>chain}});h.upload.mockResolvedValue({error:null});h.remove.mockResolvedValue({error:null});h.analyze.mockResolvedValue({analysis:{category:'identity_document',fields:{document_number:'12345678'}}});h.rpc.mockResolvedValue({data:{review_id:uuid,draft_id:uuid},error:null});});
describe('manual enrollment intake',()=>{
  it('checks permission before storing evidence',async()=>{h.permission.mockRejectedValue({status:403});expect((await POST(request())).status).toBe(403);expect(h.upload).not.toHaveBeenCalled();});
  it('requires a voucher without writing a new record',async()=>{expect((await POST(request(false))).status).toBe(400);expect(h.upload).not.toHaveBeenCalled();});
  it('does not let an adviser use a hidden conversation',async()=>{h.visible=false;expect((await POST(request())).status).toBe(403);expect(h.rpc).not.toHaveBeenCalled();});
  it('creates a pending intake without inventing registration numbers or confirming identity',async()=>{expect((await POST(request())).status).toBe(201);expect(h.rpc).toHaveBeenCalledTimes(1);expect(h.rpc).toHaveBeenCalledWith('create_manual_enrollment',expect.objectContaining({p_request_key:uuid,p_data:expect.objectContaining({identity_confirmed:false,identity_message_ids:expect.any(Array)})}));expect(h.rpc.mock.calls[0][1]).not.toHaveProperty('registered_number');});
  it('removes only the new duplicate files when the same request was already saved',async()=>{h.rpc.mockResolvedValue({data:{reused:true,review_id:uuid,draft_id:uuid},error:null});expect((await POST(request())).status).toBe(201);expect(h.remove).toHaveBeenCalledWith(expect.any(Array));});
});
