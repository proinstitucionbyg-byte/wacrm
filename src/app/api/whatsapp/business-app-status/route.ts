import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { decrypt } from '@/lib/whatsapp/encryption';
import { checkBusinessAppStatus } from '@/lib/whatsapp/business-app-status';

export const runtime = 'nodejs';
export async function GET() {
  let ctx;
  try { ctx = await requireRole('owner'); } catch (error) { return toErrorResponse(error); }
  const reply = (body: unknown, status = 200) => NextResponse.json(body, {
    status, headers: { 'Cache-Control': 'no-store' },
  });
  try {
    const { data, error } = await supabaseAdmin().from('whatsapp_config')
      .select('phone_number_id,access_token').eq('account_id', ctx.accountId).maybeSingle();
    if (error) return reply({ status: 'unknown', reason: 'configuration_unavailable' }, 503);
    if (!data) return reply({ status: 'unconfigured' });
    return reply(await checkBusinessAppStatus({ phoneNumberId: data.phone_number_id, accessToken: decrypt(data.access_token) }));
  } catch { return reply({ status: 'unknown', reason: 'configuration_unavailable' }, 503); }
}
