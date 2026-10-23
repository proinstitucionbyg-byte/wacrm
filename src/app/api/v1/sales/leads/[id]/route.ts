import { requireApiKey } from '@/lib/auth/api-context';
import { fail, ok, toApiErrorResponse } from '@/lib/api/v1/respond';
import { normalizeSalesCommercialStatus } from '@/lib/sales/commercial-status';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireApiKey(request, 'sales:write');
    const { id } = await params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return fail('bad_request', 'Contact ID must be a UUID', 400);
    }
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || !Object.hasOwn(body, 'commercial_status')) {
      return fail('bad_request', "'commercial_status' is required", 400);
    }

    const status = normalizeSalesCommercialStatus(body.commercial_status);
    if (status === undefined) {
      return fail('bad_request', 'Unsupported commercial status', 400);
    }

    const { data, error } = await ctx.supabase.rpc('sync_sales_commercial_status', {
      p_account_id: ctx.accountId,
      p_contact_id: id,
      p_status: status,
    });
    if (error) {
      if (error.code === 'P0002') return fail('not_found', 'Sales contact not found', 404);
      if (error.code === '42501') return fail('forbidden', 'Contact is not eligible for sales status updates', 403);
      console.error('[api/v1/sales/leads] status update error:', error);
      return fail('internal', 'Failed to update sales status', 500);
    }

    return ok({ contact_id: id, commercial_status: data ?? status });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
