import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/ai/admin-client';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';

export async function POST(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  try {
    const ctx = await requireRole('admin');
    const limit = checkRateLimit(`admin:memberPassword:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);
    const { userId } = await params;
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(userId)) {
      return NextResponse.json({ error: 'Cuenta no valida' }, { status: 400 });
    }
    if (userId === ctx.userId) {
      return NextResponse.json({ error: 'Cambia tu propia clave desde Tu perfil' }, { status: 400 });
    }
    const { data: member, error } = await ctx.supabase.from('profiles')
      .select('account_role').eq('account_id', ctx.accountId).eq('user_id', userId).maybeSingle();
    if (error) return NextResponse.json({ error: 'No se pudo comprobar la cuenta' }, { status: 500 });
    if (!member) return NextResponse.json({ error: 'Miembro no encontrado' }, { status: 404 });
    if (member.account_role === 'owner' || (member.account_role === 'admin' && ctx.role !== 'owner')) {
      return NextResponse.json({ error: 'No tienes permiso para restablecer esta clave' }, { status: 403 });
    }
    const body = await request.json().catch(() => null);
    if (typeof body?.password !== 'string' || body.password.length < 12 || body.password.length > 128) {
      return NextResponse.json({ error: 'La nueva clave debe tener entre 12 y 128 caracteres' }, { status: 400 });
    }
    // Never persist, log or return the password. Only Auth receives it.
    const { error: authError } = await supabaseAdmin().auth.admin.updateUserById(userId, { password: body.password });
    if (authError) return NextResponse.json({ error: 'No se pudo restablecer la clave. Intenta con otra clave.' }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
