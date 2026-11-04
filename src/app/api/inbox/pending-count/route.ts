import {NextResponse} from 'next/server';
import {requirePermission} from '@/lib/auth/permissions';
import {toErrorResponse} from '@/lib/auth/account';

export async function GET(){
 try{
  const ctx=await requirePermission('inbox','view');
  const {data,error}=await ctx.supabase.rpc('inbox_pending_contact_count',{p_account_id:ctx.accountId});
  if(error)throw error;
  const count=Number(data);
  if(!Number.isSafeInteger(count)||count<0)throw Error('No se pudo contar las conversaciones pendientes.');
  return NextResponse.json({count},{headers:{'Cache-Control':'no-store'}});
 }catch(error){return toErrorResponse(error);}
}
