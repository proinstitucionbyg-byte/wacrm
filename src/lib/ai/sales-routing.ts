import { supabaseAdmin } from './admin-client';
import { engineSendText } from '@/lib/flows/meta-send';

export async function routeInboundSales(args: { accountId:string; conversationId:string; messageId:string; contactId:string; userId:string }): Promise<boolean> {
  try {
  const {data,error}=await supabaseAdmin().rpc('route_sales_conversation',{p_account_id:args.accountId,p_conversation_id:args.conversationId,p_message_id:args.messageId});
  if(error) { console.error('[sales routing] assignment failed:',error); return false; }
  if(!data?.handled) return false;
  if(data.notify) {
    try {
      await engineSendText({accountId:args.accountId,userId:args.userId,conversationId:args.conversationId,contactId:args.contactId,text:data.assigned?'Te hemos derivado al equipo de ventas. Una persona de nuestro equipo continuará tu atención.':'Tu atención quedó pendiente con el equipo de ventas. Te contactaremos cuando haya una persona disponible.'});
    } catch(error) {console.error('[sales routing] handoff notice failed:',error);}
  }
  return true;
  } catch(error) { console.error('[sales routing] unexpected failure:',error); return false; }
}
