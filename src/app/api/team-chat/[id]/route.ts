import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { UUID_PATTERN } from '@/lib/team-chat';
type Params = { params: Promise<{ id: string }> };
export async function PATCH(request: Request, { params }: Params) {
  try {
    const ctx = await requireRole('agent'),
      { id } = await params;
    const body = await request.json().catch(() => null);
    if (
      !UUID_PATTERN.test(id) ||
      typeof body?.global !== 'boolean' ||
      typeof body?.restore !== 'boolean'
    )
      return NextResponse.json({ error: 'Acción inválida' }, { status: 400 });
    const { error } = await ctx.supabase.rpc('archive_team_thread', {
      p_thread: id,
      p_global: body.global,
      p_restore: body.restore,
    });
    if (error)
      return NextResponse.json(
        { error: 'No puedes modificar esta conversación.' },
        { status: 403 }
      );
    return NextResponse.json({ saved: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const ctx = await requireRole('owner'),
      { id } = await params;
    if (!UUID_PATTERN.test(id))
      return NextResponse.json({ error: 'Chat inválido' }, { status: 400 });
    const { error } = await ctx.supabase.rpc('delete_team_thread', {
      p_thread: id,
    });
    if (error) throw error;
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
