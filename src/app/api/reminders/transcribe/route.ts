import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { loadAiConfig } from '@/lib/ai/config';

export async function POST(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const config = await loadAiConfig(ctx.supabase, ctx.accountId, { requireActive: false });
    if (!config || config.provider !== 'openai')
      return NextResponse.json({ error: 'La transcripción de voz requiere la conexión de OpenAI.' }, { status: 503 });
    const form = await request.formData();
    const audio = form.get('audio');
    if (!(audio instanceof File) || audio.size < 100 || audio.size > 10 * 1024 * 1024 || !audio.type.startsWith('audio/'))
      return NextResponse.json({ error: 'Graba un audio de hasta 10 MB.' }, { status: 400 });
    const outbound = new FormData();
    outbound.append('model', process.env.AI_TRANSCRIBE_MODEL || 'gpt-4o-transcribe');
    outbound.append('language', 'es');
    outbound.append('file', audio, audio.name || 'recordatorio.webm');
    const result = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST', headers: { Authorization: `Bearer ${config.apiKey}` }, body: outbound,
      signal: AbortSignal.timeout(25_000),
    });
    if (!result.ok) return NextResponse.json({ error: 'No se pudo transcribir el audio.' }, { status: 502 });
    const payload = await result.json() as { text?: string };
    if (!payload.text?.trim()) return NextResponse.json({ error: 'No se entendió el audio.' }, { status: 422 });
    return NextResponse.json({ text: payload.text.trim() });
  } catch (error) { return toErrorResponse(error); }
}
