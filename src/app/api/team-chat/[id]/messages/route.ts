import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { parseTeamMessage, UUID_PATTERN } from '@/lib/team-chat';
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await params;
    const before = new URL(request.url).searchParams.get('before');
    if (!UUID_PATTERN.test(id) || (before && !UUID_PATTERN.test(before)))
      return NextResponse.json({ error: 'Chat inválido' }, { status: 400 });
    const asOf = new Date().toISOString();
    let query = ctx.supabase
      .from('team_messages')
      .select('id,sender_id,body,created_at')
      .eq('thread_id', id)
      .eq('account_id', ctx.accountId);
    if (before) {
      const { data: cursor, error } = await ctx.supabase
        .from('team_messages')
        .select('id,created_at')
        .eq('id', before)
        .eq('thread_id', id)
        .eq('account_id', ctx.accountId)
        .maybeSingle();
      if (error) throw error;
      if (!cursor)
        return NextResponse.json(
          { error: 'Mensaje no encontrado' },
          { status: 404 }
        );
      query = query.or(
        `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`
      );
    }
    const { data, error } = await query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(100);
    if (error) throw error;
    const rows = data ?? [];
    return NextResponse.json({
      messages: rows.toReversed(),
      next: rows.length === 100 ? rows[rows.length - 1].id : null,
      as_of: asOf,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await params;
    const input = parseTeamMessage(await request.json().catch(() => null));
    if (!UUID_PATTERN.test(id) || !input)
      return NextResponse.json(
        { error: 'Escribe un mensaje de hasta 4000 caracteres.' },
        { status: 400 }
      );
    const { data: room, error: roomError } = await ctx.supabase
      .from('team_threads')
      .select('id')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (roomError) throw roomError;
    if (!room)
      return NextResponse.json(
        { error: 'Chat no disponible' },
        { status: 404 }
      );
    const { data, error } = await ctx.supabase
      .from('team_messages')
      .insert({
        ...input,
        thread_id: id,
        account_id: ctx.accountId,
        sender_id: ctx.userId,
      })
      .select('id,sender_id,body,created_at')
      .single();
    if (error) {
      if (error.code === '23505') {
        const old = await ctx.supabase
          .from('team_messages')
          .select('id,sender_id,body,created_at')
          .eq('id', input.id)
          .eq('thread_id', id)
          .eq('account_id', ctx.accountId)
          .eq('sender_id', ctx.userId)
          .maybeSingle();
        if (old.error) throw old.error;
        if (old.data?.body === input.body)
          return NextResponse.json({ message: old.data });
        return NextResponse.json(
          { error: 'Actualiza antes de reintentar este envío.' },
          { status: 409 }
        );
      }
      throw error;
    }
    return NextResponse.json({ message: data }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
