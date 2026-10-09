import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { toErrorResponse } from '@/lib/auth/account';
import { commandName, resolveCommand } from '@/lib/inbox/commands';
import { UUID_PATTERN } from '@/lib/team-chat';
import { runAutomationById } from '@/lib/automations/engine';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

export async function GET() {
  try {
    const ctx = await requirePermission('inbox', 'send');
    const { data, error } = await ctx.supabase
      .from('automations')
      .select('id,name')
      .eq('account_id', ctx.accountId)
      .eq('is_active', true)
      .order('name');
    if (error) throw error;
    return NextResponse.json({ blocks: data ?? [] });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requirePermission('inbox', 'send');
    const limit = checkRateLimit(`send:${ctx.userId}`, RATE_LIMITS.send);
    if (!limit.success) return rateLimitResponse(limit);
    const body = await request.json().catch(() => null);
    const name = typeof body?.text === 'string' ? commandName(body.text) : null;
    if (
      !name ||
      !UUID_PATTERN.test(body?.conversation ?? '') ||
      !UUID_PATTERN.test(body?.request_id ?? '')
    )
      return NextResponse.json(
        {
          error:
            'Usa MANDAR(PROMOCION Y CURSO) o selecciona un bloque preparado.',
        },
        { status: 400 }
      );
    const { data: conversation } = await ctx.supabase
      .from('conversations')
      .select('id,contact_id,contact:contacts(channel)')
      .eq('id', body.conversation)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (!conversation)
      return NextResponse.json(
        { error: 'No puedes acceder a esta conversación.' },
        { status: 404 }
      );
    const contact = Array.isArray(conversation.contact)
      ? conversation.contact[0]
      : conversation.contact;
    if (contact?.channel !== 'whatsapp')
      return NextResponse.json(
        { error: 'Los bloques preparados están disponibles para WhatsApp.' },
        { status: 400 }
      );
    // The server resolves an active block in this account, never arbitrary steps from the browser.
    const db = supabaseAdmin();
    const { data: blocks, error } = await db
      .from('automations')
      .select('id,name')
      .eq('account_id', ctx.accountId)
      .eq('is_active', true);
    if (error) throw error;
    const block = resolveCommand(name, blocks ?? []);
    if (!block)
      return NextResponse.json(
        {
          error:
            'No hay un único bloque activo con ese nombre. Selecciónalo desde BLOQUES PREPARADOS.',
        },
        { status: 400 }
      );
    const { data: started, error: startError } = await ctx.supabase.rpc(
      'start_inbox_command',
      {
        p_id: body.request_id,
        p_conversation: conversation.id,
        p_automation: block.id,
      }
    );
    if (startError) throw startError;
    if (started !== true)
      return NextResponse.json(
        {
          error: 'Este envío ya se inició. Revisa el chat antes de repetirlo.',
        },
        { status: 409 }
      );
    const launched = await runAutomationById({
      accountId: ctx.accountId,
      automationId: block.id,
      contactId: conversation.contact_id,
      conversationId: conversation.id,
      manualAgentId: ctx.userId,
    });
    await db
      .from('inbox_command_runs')
      .update({ status: launched ? 'launched' : 'failed' })
      .eq('id', body.request_id)
      .eq('account_id', ctx.accountId);
    if (!launched)
      return NextResponse.json(
        {
          error:
            'El bloque no pudo completarse. Revisa sus pasos y los mensajes enviados antes de repetirlo.',
        },
        { status: 502 }
      );
    return NextResponse.json({
      launched: true,
      message:
        'Bloque iniciado. Sus pasos con espera continuarán automáticamente.',
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
