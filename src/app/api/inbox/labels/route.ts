import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { toErrorResponse } from '@/lib/auth/account';
import { parseLabelApplication } from '@/lib/inbox/controls';
export async function POST(request: Request) {
  try {
    const ctx = await requirePermission('inbox', 'tag'),
      input = parseLabelApplication(await request.json().catch(() => null));
    if (!input)
      return NextResponse.json(
        { error: 'Selecciona hasta 100 chats y una etiqueta.' },
        { status: 400 }
      );
    const { error } = await ctx.supabase.rpc('tag_conversations', {
      p_conversations: input.conversations,
      p_tag: input.tag,
      p_remove: input.remove,
    });
    if (error)
      return NextResponse.json(
        { error: 'No puedes aplicar esa etiqueta a los chats seleccionados.' },
        { status: 403 }
      );
    return NextResponse.json({ ok: true });
  } catch (e) {
    return toErrorResponse(e);
  }
}
