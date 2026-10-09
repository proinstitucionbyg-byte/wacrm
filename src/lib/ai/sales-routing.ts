import { supabaseAdmin } from './admin-client';

export async function expireSalesAssignments(): Promise<void> {
  const { error } = await supabaseAdmin().rpc('expire_sales_assignments');
  if (error) throw new Error(`Sales assignment expiry failed: ${error.message}`);
}

export async function routeWaitingSalesConversations(): Promise<void> {
  const { error } = await supabaseAdmin().rpc('route_waiting_sales_conversations');
  if (error) throw new Error(`Sales queue routing failed: ${error.message}`);
}

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
