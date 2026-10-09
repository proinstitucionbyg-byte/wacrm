import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { parseSalesRouting } from '@/lib/sales-routing';

export async function GET() {
  try {
    const ctx = await requireRole('admin');
    const [profiles, rules, config] = await Promise.all([
      ctx.supabase.from('profiles').select('user_id,full_name,email,account_role,area,cargo').eq('account_id',ctx.accountId).order('created_at'),
      ctx.supabase.from('member_sales_routing').select('user_id,percentage').eq('account_id',ctx.accountId),
      ctx.supabase.from('account_sales_routing').select('enabled,version').eq('account_id',ctx.accountId).maybeSingle(),
    ]);
    if (profiles.error) throw profiles.error;
    if (rules.error) throw rules.error;
    if (config.error) throw config.error;
    return NextResponse.json({ enabled: config.data?.enabled ?? false, version: config.data?.version ?? 0, members: (profiles.data ?? []).map((row) => ({...row, area: row.area?.toUpperCase() || 'SIN AREA', cargo: row.cargo || '', percentage: rules.data?.find((rule) => rule.user_id === row.user_id)?.percentage ?? 0 })) });
  } catch(error) { return toErrorResponse(error); }
}
export async function PUT(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const body = parseSalesRouting(await request.json().catch(() => null));
    if (!body) return NextResponse.json({error:'Revisa área, cargo y porcentajes. Para activar el reparto deben sumar 100%.'},{status:400});
    const {data,error} = await ctx.supabase.rpc('configure_sales_routing',{p_members:body.members,p_enabled:body.enabled,p_version:body.version});
    if (error) return NextResponse.json({error:error.code === '40001' ? 'El equipo o la configuración cambió. Actualiza antes de guardar.' : 'No se pudo guardar. Revisa que solo las cuentas de ventas con acceso al chat tengan porcentaje.'},{status: error.code === '40001' ? 409 : 400});
    return NextResponse.json({ok:true,version:data});
  } catch(error) { return toErrorResponse(error); }
}
