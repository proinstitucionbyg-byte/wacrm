import{beforeEach,describe,it,expect,vi}from'vitest';
const h=vi.hoisted(()=>({role:vi.fn(),from:vi.fn(),range:vi.fn(),single:vi.fn(),eq:vi.fn()}));
vi.mock('@/lib/auth/account',()=>({requireRole:h.role,toErrorResponse:()=>Response.json({error:'No autorizado'},{status:403})}));
vi.mock('@/lib/automations/admin-client',()=>({supabaseAdmin:()=>({from:h.from})}));
import{GET}from'@/app/api/multichannel/campaigns/report/route';
const id='00000000-0000-4000-8000-000000000001';
beforeEach(()=>{vi.clearAllMocks();h.role.mockResolvedValue({accountId:'account'});h.single.mockResolvedValue({data:{id,name:'Prueba',status:'paused',recipient_variables:{}},error:null});const q={select:vi.fn(),eq:h.eq,order:vi.fn(),range:h.range,maybeSingle:h.single};q.select.mockReturnValue(q);h.eq.mockReturnValue(q);q.order.mockReturnValue(q);h.from.mockReturnValue(q);});
describe('complete campaign report',()=>{
 it('requires owner access before querying',async()=>{h.role.mockRejectedValue(Error());expect((await GET(new Request('https://test/report?campaign_id='+id))).status).toBe(403);expect(h.from).not.toHaveBeenCalled();});
 it('reads every page and scopes each query to the current account and campaign',async()=>{
  const jobs=Array.from({length:1000},(_,i)=>({id:String(i),contact_id:'one',recipient:'+51900000001',status:'queued',mode:'whatsapp_live',campaign_sequence:0,started_at:null,provider_id:null}));
  h.range.mockResolvedValueOnce({data:jobs,error:null}).mockResolvedValueOnce({data:[],error:null});
  const response=await GET(new Request('https://test/report?campaign_id='+id)),data=await response.json();expect(response.status).toBe(200);expect(h.range).toHaveBeenCalledWith(1000,1999);expect(h.eq).toHaveBeenCalledWith('account_id','account');expect(h.eq).toHaveBeenCalledWith('campaign_id',id);expect(data.report.total).toBe(1);expect(data.canExport).toBe(true);
 });
 it('refuses to show partial totals if a later page fails',async()=>{h.range.mockResolvedValue({data:null,error:{message:'private'}});const response=await GET(new Request('https://test/report?campaign_id='+id));expect(response.status).toBe(503);expect(await response.text()).not.toContain('private');});
});
