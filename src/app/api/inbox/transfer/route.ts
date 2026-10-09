import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { toErrorResponse } from '@/lib/auth/account';
import { parseTransfer } from '@/lib/inbox/controls';
export async function POST(request: Request) {
  try {
    const ctx = await requirePermission('inbox', 'assign'),
      input = parseTransfer(await request.json().catch(() => null));
    if (!input)
      return NextResponse.json(
        { error: 'Selecciona destinatario y alcance del historial.' },
        { status: 400 }
      );
    const { data, error } = await ctx.supabase.rpc(
      'transfer_inbox_conversation',
      {
        p_conversation: input.conversation,
        p_agent: input.agent,
        p_full_history: input.full_history,
      }
    );
    if (error)
      return NextResponse.json(
        { error: 'No puedes traspasar este chat a esa persona.' },
        { status: 403 }
      );
    return NextResponse.json(data);
  } catch (e) {
    return toErrorResponse(e);
  }
}
