import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { readQueueJson } from '@/lib/multichannel/bounded-json';
import { whatsappSessionLineKeySchema } from '@/lib/multichannel/whatsapp-session-protocol';
const reply = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const action = z
  .object({
    user_id: z.string().uuid(),
    line_key: whatsappSessionLineKeySchema,
    expected_phone: z.string().regex(/^\d{7,15}$/),
    access: z.enum(['none', 'view', 'manage']),
  })
  .strict();
export async function GET() {
  try {
    const ctx = await requireRole('owner'),
      db = supabaseAdmin();
    const [members, grants] = await Promise.all([
      db
        .from('profiles')
        .select('user_id,full_name,account_role')
        .eq('account_id', ctx.accountId)
        .order('full_name'),
      db
        .from('whatsapp_group_line_access')
        .select('user_id,line_key,linked_phone,can_manage')
        .eq('account_id', ctx.accountId),
    ]);
    if (members.error) throw members.error;
    if (grants.error) throw grants.error;
    return reply({ members: members.data, grants: grants.data });
  } catch (error) {
    return toErrorResponse(error);
  }
}
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('owner'),
      db = supabaseAdmin();
    const decoded = await readQueueJson(request, 4000);
    if (!decoded.ok)
      return reply({ error: 'Solicitud inválida.' }, decoded.status);
    const parsed = action.safeParse(decoded.value);
    if (!parsed.success)
      return reply({ error: 'Revisa la persona y el WhatsApp.' }, 400);
    const a = parsed.data;
    const member = await db
      .from('profiles')
      .select('user_id,account_role')
      .eq('account_id', ctx.accountId)
      .eq('user_id', a.user_id)
      .maybeSingle();
    if (member.error) throw member.error;
    if (!member.data)
      return reply({ error: 'La persona no pertenece a esta cuenta.' }, 404);
    if (member.data.account_role === 'owner')
      return reply({ error: 'El CEO ya tiene acceso.' }, 400);
    if (a.access === 'none') {
      const saved = await db
        .from('whatsapp_group_line_access')
        .delete()
        .eq('account_id', ctx.accountId)
        .eq('user_id', a.user_id)
        .eq('line_key', a.line_key);
      if (saved.error) throw saved.error;
    } else {
      const line = await db
        .from('multichannel_whatsapp_session_lines')
        .select('linked_phone')
        .eq('account_id', ctx.accountId)
        .eq('line_key', a.line_key)
        .maybeSingle();
      if (line.error) throw line.error;
      if (line.data?.linked_phone !== a.expected_phone)
        return reply(
          { error: 'El número de la línea cambió. Vuelve a consultarlo.' },
          409
        );
      const saved = await db
        .from('whatsapp_group_line_access')
        .upsert(
          {
            account_id: ctx.accountId,
            user_id: a.user_id,
            line_key: a.line_key,
            linked_phone: a.expected_phone,
            can_manage: a.access === 'manage',
            granted_by: ctx.userId,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'account_id,user_id,line_key' }
        );
      if (saved.error) throw saved.error;
    }
    return reply({ saved: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
