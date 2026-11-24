import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { requireGroupLineAccess } from '@/lib/multichannel/group-access';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { readQueueJson } from '@/lib/multichannel/bounded-json';
import { groupRequest, groupResult } from '@/lib/multichannel/whatsapp-groups';
import { managementSnapshotLine } from '@/lib/multichannel/whatsapp-management';
const reply = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    if (process.env.MULTICHANNEL_WHATSAPP_SESSION_BRIDGE_ENABLED !== 'true')
      return reply({ error: 'Gestión no habilitada.' }, 503);
    const db = supabaseAdmin(),
      id = new URL(request.url).searchParams.get('command_id');
    if (id) {
      if (!z.string().uuid().safeParse(id).success)
        return reply({ error: 'Solicitud inválida.' }, 400);
      const result = await db
        .from('whatsapp_management_commands')
        .select(
          'id,line_key,expected_phone,operation,status,result,result_data,created_at'
        )
        .eq('id', id)
        .eq('account_id', ctx.accountId)
        .in('operation', ['group_list', 'group_details', 'group_mutate'])
        .maybeSingle();
      if (result.error) throw result.error;
      if (!result.data)
        return reply({ error: 'Solicitud no encontrada.' }, 404);
      await requireGroupLineAccess(
        ctx,
        result.data.line_key,
        result.data.expected_phone
      );
      if (
        result.data.result_data &&
        !groupResult.safeParse(result.data.result_data).success
      )
        return reply({ error: 'Resultado pendiente de revisión.' }, 503);
      return reply({ command: result.data });
    }
    const result = await db
      .from('multichannel_whatsapp_session_lines')
      .select('line_key,linked_phone,worker_id')
      .eq('group_primary', true)
      .eq('account_id', ctx.accountId)
      .order('line_key');
    if (result.error) throw result.error;
    const states = await db
      .from('whatsapp_management_state')
      .select('worker_id,snapshot,seen_at')
      .eq('account_id', ctx.accountId);
    if (states.error) throw states.error;
    const available = (result.data ?? []).flatMap((line) => {
      const state = (states.data ?? []).find(
        (s) => s.worker_id === line.worker_id
      );
      if (
        !state ||
        !Number.isFinite(Date.parse(state.seen_at)) ||
        Date.now() - Date.parse(state.seen_at) > 20000
      )
        return [];
      const parsed = managementSnapshotLine.array().safeParse(state.snapshot),
        live = parsed.success
          ? parsed.data.find((s) => s.lineKey === line.line_key)
          : null;
      return live &&
        !live.archived &&
        !live.label.startsWith('Historial ') &&
        live.active &&
        live.status === 'ready' &&
        live.linkedPhone === line.linked_phone
        ? [{ ...line, label: live.label }]
        : [];
    });
    if (ctx.role === 'owner')
      return reply({
        lines: available.map((line) => ({ ...line, can_manage: true })),
        canDelegate: true,
      });
    const grants = await db
      .from('whatsapp_group_line_access')
      .select('line_key,linked_phone,can_manage')
      .eq('account_id', ctx.accountId)
      .eq('user_id', ctx.userId);
    if (grants.error) throw grants.error;
    return reply({
      lines: available.flatMap((line) => {
        const grant = (grants.data ?? []).find(
          (g) =>
            g.line_key === line.line_key && g.linked_phone === line.linked_phone
        );
        return grant ? [{ ...line, can_manage: grant.can_manage }] : [];
      }),
      canDelegate: false,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
export async function POST(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    if (process.env.MULTICHANNEL_WHATSAPP_SESSION_BRIDGE_ENABLED !== 'true')
      return reply({ error: 'Gestión no habilitada.' }, 503);
    const decoded = await readQueueJson(request, 16000);
    if (!decoded.ok)
      return reply({ error: 'Solicitud inválida.' }, decoded.status);
    const parsed = groupRequest.safeParse(decoded.value);
    if (!parsed.success)
      return reply(
        { error: 'Revisa la línea, grupo y datos de la acción.' },
        400
      );
    const action = parsed.data,
      db = supabaseAdmin();
    const primary=await db.from('multichannel_whatsapp_session_lines').select('line_key').eq('account_id',ctx.accountId).eq('group_primary',true).eq('line_key',action.line_key).eq('linked_phone',action.expected_phone).maybeSingle();
    if(primary.error)throw primary.error;
    if(!primary.data)return reply({error:'Ese número no está designado para grupos. El propietario debe elegirlo primero.'},409);
    await requireGroupLineAccess(
      ctx,
      action.line_key,
      action.expected_phone,
      action.request.kind === 'mutate'
    );
    if (
      action.request.kind === 'mutate' &&
      (action.request.change.operation === 'picture' || action.request.change.operation === 'media')
    ) {
      const media = new URL(action.request.change.value.url),
        origin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '');
      if (
        media.protocol !== 'https:' ||
        media.origin !== origin.origin ||
        media.username ||
        media.password ||
        media.search ||
        media.hash ||
        !media.pathname.startsWith(
          `/storage/v1/object/public/flow-media/account-${ctx.accountId}/`
        )
      )
        return reply(
          {
            error: 'El archivo debe pertenecer al almacenamiento de esta cuenta.',
          },
          400
        );
    }
    const worker = await db
      .from('multichannel_workers')
      .select('id')
      .eq('id', action.worker_id)
      .eq('account_id', ctx.accountId)
      .eq('enabled', true)
      .maybeSingle();
    if (worker.error) throw worker.error;
    if (!worker.data) return reply({ error: 'Servidor no disponible.' }, 404);
    const state = await db
      .from('whatsapp_management_state')
      .select('snapshot,seen_at')
      .eq('worker_id', action.worker_id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (state.error) throw state.error;
    if (
      !state.data ||
      !Number.isFinite(Date.parse(state.data.seen_at)) ||
      Date.now() - Date.parse(state.data.seen_at) > 20000
    )
      return reply(
        { error: 'Actualiza la conexión de esta línea antes de continuar.' },
        409
      );
    const snapshot = managementSnapshotLine
        .array()
        .safeParse(state.data.snapshot),
      line = snapshot.success
        ? snapshot.data.find((l) => l.lineKey === action.line_key)
        : null;
    if (
      !line ||
      line.archived ||
      line.label.startsWith('Historial ') ||
      !line.active ||
      line.status !== 'ready' ||
      line.linkedPhone !== action.expected_phone
    )
      return reply(
        {
          error:
            'El WhatsApp seleccionado no está conectado o cambió de número.',
        },
        409
      );
    const operation = 'group_' + action.request.kind;
    const existing = await db
      .from('whatsapp_management_commands')
      .select('id,worker_id,operation,line_key,expected_phone,payload')
      .eq('id', action.request_id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) {
      const previous = groupRequest.shape.request.safeParse(
        existing.data.payload
      );
      if (
        existing.data.worker_id !== action.worker_id ||
        existing.data.operation !== operation ||
        existing.data.line_key !== action.line_key ||
        existing.data.expected_phone !== action.expected_phone ||
        !previous.success ||
        JSON.stringify(previous.data) !== JSON.stringify(action.request)
      )
        return reply({ error: 'La solicitud ya existe con otros datos.' }, 409);
      return reply({ command: { id: existing.data.id } }, 202);
    }
    const result = await db
      .from('whatsapp_management_commands')
      .insert({
        id: action.request_id,
        account_id: ctx.accountId,
        requested_by: ctx.userId,
        worker_id: action.worker_id,
        line_key: action.line_key,
        expected_phone: action.expected_phone,
        operation,
        payload: action.request,
      })
      .select('id')
      .single();
    if (result.error?.code === '23505')
      return reply(
        {
          error:
            'Hay una acción en curso. Consulta su estado antes de repetir.',
        },
        409
      );
    if (result.error) throw result.error;
    return reply({ command: result.data }, 202);
  } catch (error) {
    return toErrorResponse(error);
  }
}
