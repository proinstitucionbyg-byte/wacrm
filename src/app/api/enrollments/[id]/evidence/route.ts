import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { parseEnrollmentData } from '@/lib/matriculas/enrollment';
import { declarationImage } from '@/lib/matriculas/declaration-image';
import { manualEvidenceIssue } from '@/lib/matriculas/manual-evidence';

export const runtime = 'nodejs';
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let path: string | null = null;
  try {
    const ctx = await requirePermission('enrollments', 'edit');
    const { id } = await params;
    const form = await request.formData();
    const version = Number(form.get('version'));
    const { data: draft, error } = await ctx.supabase.from('enrollment_drafts').select('id,review_id,status,version').eq('account_id', ctx.accountId).eq('id', id).maybeSingle();
    if (error) throw error;
    if (!draft) return NextResponse.json({ error: 'Matrícula no encontrada.' }, { status: 404 });
    if (!['collecting', 'error'].includes(draft.status)) return NextResponse.json({ error: 'La ficha está en registro o ya fue registrada. Usa su corrección; no vuelvas a matricular.' }, { status: 409 });
    if (!Number.isSafeInteger(version) || version !== draft.version) return NextResponse.json({ error: 'La ficha cambió. Guarda o actualiza sus datos antes de adjuntar el respaldo.' }, { status: 409 });
    let kind = String(form.get('kind')), buffer: Buffer, mime: string;
    let analysis: Record<string, unknown> | null = null;
    if (kind === 'confirmation') {
      let data;
      try { data = parseEnrollmentData(JSON.parse(String(form.get('data') || '{}'))); } catch { data = null; }
      if (!data) return NextResponse.json({ error: 'Revisa los datos del estudiante.' }, { status: 400 });
      const source = form.get('source'), phone = String(form.get('phone') || '').replace(/[\s()-]/g, '');
      const issue = manualEvidenceIssue(data, source, phone, form.get('confirmed') === 'true');
      if (issue) return NextResponse.json({ error: issue }, { status: 400 });
      const note = String(form.get('note') || '').trim().slice(0, 1000);
      const at = new Date().toISOString();
      const text = ['NOMBRE: ' + data.full_name, 'DOCUMENTO: ' + data.document_type + ' ' + data.document_number, 'CORREO: ' + data.email, 'ORIGEN: ' + (source === 'call' ? 'LLAMADA' : 'OTRO WHATSAPP'), 'TELEFONO CONFIRMADO: ' + phone, 'REGISTRADO POR: ' + ctx.userId, note ? 'NOTA: ' + note : ''].filter(Boolean).join('\n');
      const image = declarationImage({ content_text: text, created_at: at }, { title: 'DATOS CONFIRMADOS POR LA ASESORA', subtitle: 'REGISTRO MANUAL. NO ES UN MENSAJE ESCRITO POR EL ESTUDIANTE NI UNA FOTO DE SU DOCUMENTO.' });
      buffer = Buffer.from(await image.arrayBuffer()); mime = 'image/png'; kind = 'declaration';
      analysis = { category: 'staff_confirmed_identity', fields: { full_name: data.full_name, document_type: data.document_type, document_number: data.document_number, email: data.email }, source, source_phone: phone, note, recorded_by: ctx.userId, recorded_at: at };
    } else {
      if (!['front', 'back', 'declaration', 'guardian'].includes(kind)) return NextResponse.json({ error: 'Elige documento, respaldo de otro chat o documento del tutor.' }, { status: 400 });
      const file = form.get('file');
      if (!(file instanceof File) || !file.size || file.size > 10 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return NextResponse.json({ error: 'Selecciona una imagen JPG, PNG o WEBP de hasta 10 MB.' }, { status: 400 });
      buffer = Buffer.from(await file.arrayBuffer()); mime = file.type;
    }
    const db = supabaseAdmin(), evidenceId = randomUUID();
    path = `${ctx.accountId}/manual/${draft.review_id}/${evidenceId}`;
    const upload = await db.storage.from('enrollment-evidence').upload(path, buffer, { contentType: mime, upsert: false });
    if (upload.error) throw upload.error;
    const inserted = await db.from('enrollment_uploads').insert({ id: evidenceId, account_id: ctx.accountId, review_id: draft.review_id, kind, storage_path: path, mime_type: mime, image_analysis: analysis, uploaded_by: ctx.userId });
    if (inserted.error) throw inserted.error;
    path = null;
    return NextResponse.json({ evidence: { id: evidenceId, kind, url: `/api/enrollments/uploads/${evidenceId}` }, message: 'Respaldo adjuntado. Guarda los datos de la ficha para usarlo.' }, { status: 201 });
  } catch (error) {
    if (path) await supabaseAdmin().storage.from('enrollment-evidence').remove([path]);
    return toErrorResponse(error);
  }
}
