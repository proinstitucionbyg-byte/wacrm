import { ForbiddenError, type AccountContext } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';

export async function requireGroupLineAccess(
  ctx: AccountContext,
  lineKey: string,
  phone: string,
  manage = false
) {
  if (ctx.role === 'owner') return;
  const db = supabaseAdmin();
  const line = await db
    .from('multichannel_whatsapp_session_lines')
    .select('linked_phone')
    .eq('account_id', ctx.accountId)
    .eq('line_key', lineKey)
    .maybeSingle();
  if (line.error) throw line.error;
  if (line.data?.linked_phone !== phone)
    throw new ForbiddenError(
      'El número de esta línea cambió; el CEO debe renovar el acceso.'
    );
  const { data, error } = await db
    .from('whatsapp_group_line_access')
    .select('can_manage')
    .eq('account_id', ctx.accountId)
    .eq('user_id', ctx.userId)
    .eq('line_key', lineKey)
    .eq('linked_phone', phone)
    .maybeSingle();
  if (error) throw error;
  if (!data || (manage && !data.can_manage))
    throw new ForbiddenError(
      'El CEO debe darte acceso a los grupos de este WhatsApp.'
    );
}
