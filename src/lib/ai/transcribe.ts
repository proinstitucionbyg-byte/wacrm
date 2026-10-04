import type { supabaseAdmin } from './admin-client'
import { loadAiConfig } from './config'
import { getMediaUrl, downloadMedia } from '@/lib/whatsapp/meta-api'

type Db = ReturnType<typeof supabaseAdmin>

/** OpenAI speech-to-text model. Override with AI_TRANSCRIBE_MODEL. */
function transcribeModel(): string {
  return process.env.AI_TRANSCRIBE_MODEL || 'gpt-4o-transcribe'
}

/** OpenAI accepts files up to 25 MB; stay safely under it. */
const MAX_AUDIO_BYTES = 20 * 1024 * 1024
const TRANSCRIBE_TIMEOUT_MS = 25_000

function extensionFor(contentType: string): string {
  const t = contentType.toLowerCase()
  if (t.includes('mpeg') || t.includes('mp3')) return 'mp3'
  if (t.includes('mp4') || t.includes('m4a') || t.includes('aac')) return 'm4a'
  if (t.includes('wav')) return 'wav'
  if (t.includes('webm')) return 'webm'
  return 'ogg' // WhatsApp voice notes are audio/ogg (opus)
}

/**
 * Download an inbound WhatsApp audio from Meta and transcribe it with
 * OpenAI. Returns the text, or null when the account's AI is off, the
 * provider is not OpenAI, the audio is too big, or anything fails.
 * Never throws: a failed transcription must not break the webhook.
 */
export async function transcribeInboundAudio(args: {
  db: Db
  accountId: string
  mediaId: string
  accessToken: string
}): Promise<string | null> {
  try {
    const config = await loadAiConfig(args.db, args.accountId)
    if (!config || !config.isActive || !config.autoReplyEnabled) return null
    // Only OpenAI offers speech-to-text through the key the account stores.
    if (config.provider !== 'openai') return null

    const { url } = await getMediaUrl({
      mediaId: args.mediaId,
      accessToken: args.accessToken,
    })
    const { buffer, contentType } = await downloadMedia({
      downloadUrl: url,
      accessToken: args.accessToken,
    })
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_AUDIO_BYTES) {
      return null
    }

    const form = new FormData()
    form.append('model', transcribeModel())
    form.append('language', 'es')
    form.append(
      'file',
      new Blob([new Uint8Array(buffer)], { type: contentType }),
      `audio.${extensionFor(contentType)}`,
    )

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}` },
      body: form,
      signal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS),
    })
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300)
      console.error('[ai audio] transcription failed:', res.status, detail)
      return null
    }

    const data = (await res.json()) as { text?: string }
    const text = (data.text ?? '').trim()
    return text.length > 0 ? text : null
  } catch (err) {
    console.error('[ai audio] transcription error:', err)
    return null
  }
}