import { requireApiKey } from '@/lib/auth/api-context';
import { ok, toApiErrorResponse } from '@/lib/api/v1/respond';

/** CRM is the source of truth for sales staff; the sheet mirrors this roster. */
export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'sales:read');
    const [profiles, routing, config] = await Promise.all([
      ctx.supabase
        .from('profiles')
        .select('user_id,full_name,nickname,email,area,cargo,account_role')
        .eq('account_id', ctx.accountId)
        .ilike('area', 'ventas')
        .order('created_at', { ascending: true }),
      ctx.supabase
        .from('member_sales_routing')
        .select('user_id,percentage')
        .eq('account_id', ctx.accountId),
      ctx.supabase
        .from('account_sales_routing')
        .select('enabled,version')
        .eq('account_id', ctx.accountId)
        .maybeSingle(),
    ]);

    if (profiles.error) throw profiles.error;
    if (routing.error) throw routing.error;
    if (config.error) throw config.error;

    const percentageByUser = new Map(
      (routing.data ?? []).map((item) => [item.user_id, item.percentage]),
    );
    const advisers = (profiles.data ?? []).map((profile) => ({
      user_id: profile.user_id,
      name: profile.nickname?.trim() || profile.full_name?.trim() || 'Sin nombre',
      email: profile.email,
      area: 'Ventas',
      cargo: profile.cargo?.trim() || 'Agente',
      percentage: percentageByUser.get(profile.user_id) ?? 0,
      active_for_sales: (percentageByUser.get(profile.user_id) ?? 0) > 0,
      account_role: profile.account_role,
    }));

    if (advisers.length > 100) {
      return Response.json(
        { error: { code: 'roster_limit', message: 'La hoja comercial admite hasta 100 asesoras; no se sincronizó una lista incompleta.' } },
        { status: 409 },
      );
    }

    return ok({
      advisers,
      automatic_distribution_enabled: config.data?.enabled ?? false,
      version: config.data?.version ?? 0,
    });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
