import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { UUID_PATTERN } from '@/lib/team-chat';
const TYPES = new Set(['image/jpeg','image/png','image/webp','application/pdf','text/plain','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation','audio/ogg','audio/mpeg','video/mp4']);
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) return NextResponse.json({ error: 'Chat invalido' }, { status: 400 });
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File) || !file.size || file.size > 16 * 1024 * 1024 || !TYPES.has(file.type)) return NextResponse.json({ error: 'Usa una imagen, PDF, documento, audio o video de hasta 16 MB.' }, { status: 400 });
    const path = `account-${ctx.accountId}/${id}/${crypto.randomUUID()}`;
    // The private bucket policy checks actual membership and archived status.
    const { error } = await ctx.supabase.storage.from('team-chat-media').upload(path, file, { contentType: file.type, upsert: false });
    if (error) return NextResponse.json({ error: 'No se pudo adjuntar el archivo en este chat.' }, { status: 403 });
    return NextResponse.json({ attachment_path: path, attachment_name: file.name.replace(/[\u0000-\u001f]/g, '').slice(0,180) || 'ARCHIVO' });
  } catch (error) { return toErrorResponse(error); }
}
