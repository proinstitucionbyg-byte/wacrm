import type {SupabaseClient} from '@supabase/supabase-js'
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Owner-approved, expiring server-side test scope. Never changes financial records. */
export function automationTestSession(account:string,conversation:string|undefined){
 try{const s=JSON.parse(process.env.WACRM_AUTOMATION_TEST_SESSION??'null');
 if(!s||s.account!==account||s.conversation!==conversation||!uuid.test(account)||!uuid.test(conversation??'')||!Number.isFinite(Date.parse(s.expiresAt))||Date.parse(s.expiresAt)<=Date.now()||!Array.isArray(s.reviewIds)||s.reviewIds.length>10||!s.reviewIds.every((id:unknown)=>typeof id==='string'&&uuid.test(id)))return null;
 return {reviewIds:s.reviewIds as string[],allowAi:s.allowAi===true};}catch{return null}
}
export function activeConversationPayments(db:SupabaseClient,account:string,conversation:string){
 const q=db.from('payment_reviews').select('id,status').eq('account_id',account).eq('conversation_id',conversation);
 const session=automationTestSession(account,conversation);
 return session?.reviewIds.length?q.not('id','in','('+session.reviewIds.join(',')+')'):q;
}
