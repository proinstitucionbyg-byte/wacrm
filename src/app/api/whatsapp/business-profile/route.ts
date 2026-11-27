import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { decrypt } from '@/lib/whatsapp/encryption';
import { publishBusinessPhoto, readBusinessPhoto } from '@/lib/whatsapp/business-profile';

export const runtime = 'nodejs';
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

async function connection(accountId: string) {
  const { data, error } = await supabaseAdmin().from('whatsapp_config')
    .select('phone_number_id,access_token').eq('account_id', accountId).maybeSingle();
  if (error || !data?.phone_number_id || !data.access_token) throw new Error('Primero configura la conexión de WhatsApp API.');
  return { id: data.phone_number_id, token: decrypt(data.access_token) };
}

export async function GET() {
  let ctx;
  try { ctx = await requireRole('owner'); } catch (error) { return toErrorResponse(error); }
  try {
    const config = await connection(ctx.accountId);
    return reply(await readBusinessPhoto(config.token, config.id));
  } catch (error) { return reply({ error: error instanceof Error ? error.message : 'No se pudo consultar la foto pública.' }, 502); }
}

export async function POST(request: Request) {
  let ctx;
  try { ctx = await requireRole('owner'); } catch (error) { return toErrorResponse(error); }
  if (Number(request.headers.get('content-length') ?? 0) > 6 * 1024 * 1024) return reply({ error: 'La imagen supera 5 MB.' }, 413);
  try {
    const form = await request.formData();
    const file = form.get('photo');
    const expectedPhone = form.get('phone');
    if (!(file instanceof File) || typeof expectedPhone !== 'string') return reply({ error: 'Selecciona una imagen y verifica el número.' }, 400);
    const config = await connection(ctx.accountId);
    return reply(await publishBusinessPhoto(config.token, config.id, expectedPhone, file));
  } catch (error) { return reply({ error: error instanceof Error ? error.message : 'No se pudo publicar la foto.' }, 502); }
}
