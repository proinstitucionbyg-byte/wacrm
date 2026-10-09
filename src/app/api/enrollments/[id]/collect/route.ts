import { NextResponse } from 'next/server';
import { toErrorResponse } from '@/lib/auth/account';
import { requirePermission } from '@/lib/auth/permissions';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { collectConversationEnrollments } from '@/lib/matriculas/collect';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requirePermission('enrollments', 'edit');
    const { id } = await params;
    const { data: draft, error } = await ctx.supabase
      .from('enrollment_drafts')
      .select('conversation_id')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (error) throw error;
    if (!draft)
      return NextResponse.json(
        { error: 'Matrícula no encontrada' },
        { status: 404 }
      );
    if (draft.conversation_id)
      await collectConversationEnrollments(
        supabaseAdmin(),
        ctx.accountId,
        draft.conversation_id
      );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
