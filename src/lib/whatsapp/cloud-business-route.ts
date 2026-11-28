import type {SupabaseClient} from '@supabase/supabase-js'

export const CLOUD_BUSINESS_OPENING_DELAY_MS=3*60_000

export async function cloudBusinessRouteEnabled(db:SupabaseClient,accountId:string):Promise<boolean>{
  const {data,error}=await db.from('whatsapp_support_routes').select('enabled,automatic_sales_handoff')
    .eq('account_id',accountId).maybeSingle()
  if(error)throw Error('No se pudo verificar la ruta automática de Business')
  return data?.enabled===true&&data?.automatic_sales_handoff===true
}

/** No message is sent here; the original automation continues on this route. */
export async function prepareCloudBusinessRoute(db:SupabaseClient,args:{accountId:string;conversationId:string;messageId:string}):Promise<void>{
  const {data,error}=await db.rpc('prepare_cloud_business_route',{
    p_account_id:args.accountId,p_conversation_id:args.conversationId,p_provider_id:args.messageId,
  })
  if(error||data?.ready!==true)throw Error('No hay una ruta Business confirmada; no se enviará por API como alternativa')
}
