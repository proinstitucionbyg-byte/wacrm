import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { isMemberPreset } from '@/lib/account/member-presets';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
export async function POST(request:Request,{params}:{params:Promise<{userId:string}>}) {
  try {
    const ctx=await requireRole('admin');
    const limit=checkRateLimit(`admin:memberPreset:${ctx.userId}`,RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);
    const body=await request.json().catch(()=>null);
    if (!isMemberPreset(body?.preset)) return NextResponse.json({error:'Perfil no valido'},{status:400});
    const {userId}=await params;
    const {error}=await ctx.supabase.rpc('apply_member_preset',{p_user_id:userId,p_preset:body.preset});
    if(error) return NextResponse.json({error:'No se pudo aplicar el perfil. Solo el CEO puede cambiar administradores.'},{status:error.code==='42501'?403:400});
    return NextResponse.json({ok:true});
  }catch(err){return toErrorResponse(err);}
}
