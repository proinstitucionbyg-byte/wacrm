import { supabaseAdmin } from './admin-client';

export async function routeInboundSales(args: { accountId:string; conversationId:string; messageId:string }): Promise<boolean> {
  try {
  const {data,error}=await supabaseAdmin().rpc('route_sales_conversation',{p_account_id:args.accountId,p_conversation_id:args.conversationId,p_message_id:args.messageId});
  if(error) { console.error('[sales routing] assignment failed:',error); return false; }
  if(!data?.handled) return false;
  // Internal assignment only. Existing automation/AI keeps attending the
  // student, so do not send an automatic human-handoff announcement.
  return true;
  } catch(error) { console.error('[sales routing] unexpected failure:',error); return false; }
}
