import { NextResponse } from 'next/server';
import { toErrorResponse } from '@/lib/auth/account';
import { requirePermission } from '@/lib/auth/permissions';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { collectConversationEnrollments } from '@/lib/matriculas/collect';
import { courseKey } from '@/lib/matriculas/calendar';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requirePermission('enrollments', 'edit');
    const { id } = await params;
    const body = await request.json().catch(() => null);
    const { data: draft, error } = await ctx.supabase
      .from('enrollment_drafts')
      .select('conversation_id,data,version')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (error) throw error;
    if (!draft)
      return NextResponse.json(
        { error: 'Matrícula no encontrada' },
        { status: 404 }
      );
    const selected = body?.selected === true;
    if (
      selected &&
      (body.version !== draft.version || !courseKey(draft.data?.course ?? ''))
    )
      return NextResponse.json(
        {
          error:
            'Guarda el curso de esta ficha y actualiza antes de recoger sus datos.',
        },
        { status: 409 }
      );
    if (draft.conversation_id)
      await collectConversationEnrollments(
        supabaseAdmin(),
        ctx.accountId,
        draft.conversation_id,
        selected ? id : undefined
      );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
