import type {SupabaseClient} from '@supabase/supabase-js'

/** A short quiet period coalesces consecutive messages across server instances.
 * The durable claim prevents duplicate replies to the same latest inbound. */
export async function claimAiReplyTurn(db:SupabaseClient,account:string,conversation:string,
  wait:(ms:number)=>Promise<void>=ms=>new Promise(resolve=>setTimeout(resolve,ms))){
  await wait(2500)
  const {data,error}=await db.rpc('claim_ai_reply_turn',{p_account:account,p_conversation:conversation})
  if(error)throw error
  const claimed=data?.[0] as {token:string}|undefined
  if(!claimed?.token)return null
  return async()=>{
    const {data:current,error:checkError}=await db.rpc('ai_reply_turn_is_current',{
      p_account:account,p_conversation:conversation,p_token:claimed.token,
    })
    if(checkError)throw checkError
    return current===true
  }
}
