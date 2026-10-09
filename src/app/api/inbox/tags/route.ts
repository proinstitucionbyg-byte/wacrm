import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { toErrorResponse } from '@/lib/auth/account';
import { parseInboxTag } from '@/lib/inbox/controls';
import { UUID_PATTERN } from '@/lib/team-chat';
export async function GET() {
  try {
    const ctx = await requirePermission('inbox', 'view');
    const [tags, members] = await Promise.all([
      ctx.supabase
        .from('tags')
        .select('*')
        .eq('account_id', ctx.accountId)
        .order('name'),
      ctx.supabase
        .from('profiles')
        .select('user_id,full_name,nickname,area,account_role')
        .eq('account_id', ctx.accountId),
    ]);
    if (tags.error || members.error) throw tags.error || members.error;
    return NextResponse.json({ tags: tags.data, members: members.data });
  } catch (e) {
    return toErrorResponse(e);
  }
}
export async function POST(request: Request) {
  try {
    const ctx = await requirePermission('tags', 'manage'),
      input = parseInboxTag(await request.json().catch(() => null));
    if (!input)
      return NextResponse.json(
        { error: 'Selecciona nombre, color y destinatarios válidos.' },
        { status: 400 }
      );
    const { data, error } = await ctx.supabase.rpc('save_inbox_tag', {
      p_id: input.id,
      p_name: input.name,
      p_color: input.color,
      p_kind: input.kind,
      p_audience: input.audience,
    });
    if (error) throw error;
    return NextResponse.json({ id: data });
  } catch (e) {
    return toErrorResponse(e);
  }
}
export async function DELETE(request: Request) {
  try {
    const ctx = await requirePermission('tags', 'manage'),
      input = await request.json().catch(() => null);
    if (!UUID_PATTERN.test(input?.id ?? ''))
      return NextResponse.json({ error: 'Etiqueta inválida' }, { status: 400 });
    const { error } = await ctx.supabase.rpc('delete_inbox_tag', {
      p_id: input.id,
    });
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return toErrorResponse(e);
  }
}
