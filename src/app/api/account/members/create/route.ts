import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/ai/admin-client';
import { isMemberPreset } from '@/lib/account/member-presets';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const limit = checkRateLimit(`admin:memberCreate:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);
    const body = await request.json().catch(() => null);
    if (typeof body?.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim()) || body.email.length>254 ||
      typeof body.password !== 'string' || body.password.length<12 || body.password.length>128 ||
      typeof body.name !== 'string' || !body.name.trim() || body.name.length>120 ||
      typeof body.nickname !== 'string' || !body.nickname.trim() || body.nickname.length>80 || !isMemberPreset(body.preset)) {
      return NextResponse.json({error:'Completa nombre, apodo, correo, perfil y una clave de 12 a 128 caracteres'},{status:400});
    }
    if (body.preset==='administrador' && ctx.role!=='owner') {
      return NextResponse.json({error:'Solo el CEO puede crear administradores'},{status:403});
    }
    const db = supabaseAdmin();
    // Never change an existing user's password or account during creation.
    const {data,error} = await db.auth.admin.createUser({email:body.email.trim().toLowerCase(),password:body.password,email_confirm:true,user_metadata:{full_name:body.name.trim()}});
    if (error || !data.user) return NextResponse.json({error:'No se pudo crear la cuenta. Revisa si el correo ya esta registrado.'},{status:400});
    const {error:attachError} = await db.rpc('attach_created_team_member',{
      p_caller:ctx.userId,p_account:ctx.accountId,p_user:data.user.id,p_preset:body.preset,p_name:body.name.trim(),p_nickname:body.nickname.trim(),
    });
    if (attachError) {
      // Failed attachment is atomic: no access to this CRM has been granted.
      const {error:banError} = await db.auth.admin.updateUserById(data.user.id,{ban_duration:'876000h'});
      return NextResponse.json({error:banError
        ? 'No se pudo activar la cuenta en tu equipo ni confirmar su bloqueo. No tiene acceso a este CRM; contacta a administracion.'
        : 'No se pudo activar la cuenta en tu equipo. La cuenta creada queda bloqueada; contacta a administracion.',userId:data.user.id},{status:500});
    }
    return NextResponse.json({ok:true,userId:data.user.id},{status:201});
  } catch(err) { return toErrorResponse(err); }
}
