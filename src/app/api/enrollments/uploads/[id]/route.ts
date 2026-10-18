import {NextResponse} from 'next/server';
import {getCurrentAccount,toErrorResponse} from '@/lib/auth/account';
import {supabaseAdmin} from '@/lib/flows/admin-client';
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){try{
  const ctx=await getCurrentAccount();const {id}=await params;
  const {data:file,error}=await ctx.supabase.from('enrollment_uploads').select('storage_path,mime_type').eq('id',id).eq('account_id',ctx.accountId).maybeSingle();
  if(error)throw error;if(!file)return NextResponse.json({error:'Archivo no disponible'},{status:404});
  const {data:blob,error:downloadError}=await supabaseAdmin().storage.from('enrollment-evidence').download(file.storage_path);
  if(downloadError)throw downloadError;
  return new Response(blob,{headers:{'Content-Type':file.mime_type,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
}catch(error){return toErrorResponse(error);}}
