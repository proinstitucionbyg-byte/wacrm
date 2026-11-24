import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { UUID_PATTERN } from '@/lib/team-chat';
import { manualDocumentDelivery } from '@/lib/matriculas/manual-document-delivery';

/** Records only what a staff member explicitly declares; no message is sent. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission('enrollments', 'edit');
    const { id } = await params;
    const body = await request.json().catch(() => null);
    if (!UUID_PATTERN.test(id) || typeof body?.sent !== 'boolean'
        || !Number.isSafeInteger(body?.version) || body.version < 0)
      return NextResponse.json({ error: 'Marca de entrega inválida' }, { status: 400 });
    const { data, error } = await supabaseAdmin().rpc('set_enrollment_manual_document_delivery', {
      p_account_id: ctx.accountId, p_enrollment_id: id, p_actor: ctx.userId,
      p_sent: body.sent, p_expected_version: body.version,
    });
    if (error) {
      const messages: Record<string, [number, string]> = {
        '42501': [403, 'No puedes registrar esta entrega.'],
        P0002: [404, 'Matrícula no encontrada.'],
        '22023': [409, 'Primero completa el registro y la carpeta de documentos.'],
        '40001': [409, 'La ficha cambió. Pulsa Actualizar y vuelve a marcar.'],
      };
      const mapped = messages[error.code];
      if (mapped) return NextResponse.json({ error: mapped[1] }, { status: mapped[0] });
      throw error;
    }
    if (!data || !Number.isSafeInteger(data.version)) throw Error('Missing delivery result');
    return NextResponse.json({ version: data.version,
      manual_delivery: manualDocumentDelivery(data.receipt, data.receipt?.folder_url ?? null) });
  } catch (error) {
    return toErrorResponse(error);
  }
}
