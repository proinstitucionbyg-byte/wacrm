import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';

export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const teamView = new URL(request.url).searchParams.get('scope') === 'team';
    if (teamView && ctx.role !== 'owner') {
      return NextResponse.json({ error: 'Solo el CEO puede ver los recordatorios del equipo.' }, { status: 403 });
    }
    let query = ctx.supabase.from('adviser_reminders').select('id,user_id,body,due_at,repeat_days,conversation_id,status')
      .eq('account_id', ctx.accountId).eq('status', 'active');
    if (!teamView) query = query.eq('user_id', ctx.userId);
    const { data, error } = await query.order('due_at', { ascending: true }).limit(100);
    if (error) throw error;
    let names = new Map<string, string>();
    if (teamView && data?.length) {
      const { data: profiles, error: profileError } = await ctx.supabase.from('profiles')
        .select('user_id,full_name,email').eq('account_id', ctx.accountId)
        .in('user_id', [...new Set(data.map(item => item.user_id))]);
      if (profileError) throw profileError;
      names = new Map((profiles ?? []).map(profile => [profile.user_id, profile.full_name || profile.email || 'Asesora']));
    }
    return NextResponse.json({ reminders: (data ?? []).map(item => ({ ...item, owner_name: names.get(item.user_id) ?? null })),
      canViewTeam: ctx.role === 'owner', currentUserId: ctx.userId });
  } catch (error) { return toErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const input = await request.json().catch(() => null) as Record<string, unknown> | null;
    const body = typeof input?.body === 'string' ? input.body.trim() : '';
    const dueAt = typeof input?.due_at === 'string' ? new Date(input.due_at) : new Date(NaN);
    const repeatDays = input?.repeat_days == null ? null : Number(input.repeat_days);
    const conversationId = typeof input?.conversation_id === 'string' ? input.conversation_id : null;
    if (!body || body.length > 1000 || !Number.isFinite(dueAt.getTime()) || dueAt.getTime() < Date.now() + 10_000
      || dueAt.getTime() > Date.now() + 5 * 365 * 86400_000
      || (repeatDays !== null && (!Number.isInteger(repeatDays) || repeatDays < 1 || repeatDays > 365))) {
      return NextResponse.json({ error: 'Escribe el recordatorio y elige una fecha futura válida.' }, { status: 400 });
    }
    if (conversationId) {
      const { data: visible, error: visibilityError } = await ctx.supabase.from('conversations').select('id')
        .eq('id', conversationId).eq('account_id', ctx.accountId).maybeSingle();
      if (visibilityError) throw visibilityError;
      if (!visible) return NextResponse.json({ error: 'No tienes acceso a ese chat.' }, { status: 403 });
    }
    const { data, error } = await ctx.supabase.from('adviser_reminders').insert({
      account_id: ctx.accountId, user_id: ctx.userId, conversation_id: conversationId,
      body, due_at: dueAt.toISOString(), repeat_days: repeatDays,
    }).select('id,body,due_at,repeat_days,conversation_id,status').single();
    if (error) throw error;
    return NextResponse.json({ reminder: data }, { status: 201 });
  } catch (error) { return toErrorResponse(error); }
}
