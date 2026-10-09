import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({rpc:vi.fn(),send:vi.fn()}));
vi.mock('./admin-client',()=>({supabaseAdmin:()=>({rpc:mocks.rpc})}));
vi.mock('@/lib/flows/meta-send',()=>({engineSendText:mocks.send}));
import {routeInboundSales} from './sales-routing';
const args={accountId:'account',conversationId:'conversation',messageId:'meta-message',contactId:'contact',userId:'owner'};
beforeEach(()=>{vi.resetAllMocks();mocks.send.mockResolvedValue({});});
describe('sales handoff',()=>{
  it('does nothing when disabled or before four turns',async()=>{mocks.rpc.mockResolvedValue({data:{handled:false},error:null});expect(await routeInboundSales(args)).toBe(false);expect(mocks.send).not.toHaveBeenCalled();});
  it('uses the scoped inbound to choose a recipient atomically',async()=>{mocks.rpc.mockResolvedValue({data:{handled:true,assigned:true,notify:true},error:null});expect(await routeInboundSales(args)).toBe(true);expect(mocks.rpc).toHaveBeenCalledWith('route_sales_conversation',{p_account_id:'account',p_conversation_id:'conversation',p_message_id:'meta-message'});expect(mocks.send).toHaveBeenCalledTimes(1);});
  it('does not repeat a handoff notice on later messages',async()=>{mocks.rpc.mockResolvedValue({data:{handled:true,notify:false},error:null});expect(await routeInboundSales(args)).toBe(true);expect(mocks.send).not.toHaveBeenCalled();});
  it('keeps the assignment when WhatsApp notice fails',async()=>{mocks.rpc.mockResolvedValue({data:{handled:true,assigned:true,notify:true},error:null});mocks.send.mockRejectedValue(new Error('Meta unavailable'));expect(await routeInboundSales(args)).toBe(true);});
  it('does not lose an incoming message on a database failure',async()=>{mocks.rpc.mockRejectedValue(new Error('database offline'));expect(await routeInboundSales(args)).toBe(false);});
});
