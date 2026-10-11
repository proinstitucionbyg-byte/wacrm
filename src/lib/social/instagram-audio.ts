import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, writeFile, unlink, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { downloadSocialMedia } from './media'
import { SOCIAL_MEDIA_BUCKET } from './storage'

const run = promisify(execFile)

/** Convert the original recording, without changing its words or replacing
 * WhatsApp's source. Only called after the caller verified conversation access.
 * Meta fetches a private, short-lived M4A URL; the CRM retains the original URL. */
export async function instagramAudioUrl(accountId: string, sourceUrl: string): Promise<string> {
  if (!/^[a-zA-Z0-9-]+$/.test(accountId)) throw new Error('Cuenta de audio inválida.')
  const media = await downloadSocialMedia(sourceUrl)
  // Reject playlists and arbitrary documents before invoking a media parser.
  const head = media.buffer.subarray(0, 12)
  if (!(head.subarray(0, 4).toString() === 'OggS' || head.subarray(0, 4).toString() === 'RIFF'
    || head.subarray(0, 3).toString() === 'ID3' || head.subarray(4, 8).toString() === 'ftyp'
    || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0))) throw new Error('El archivo no es un audio compatible.')
  const dir = await mkdtemp(join(tmpdir(), 'wacrm-ig-audio-'))
  const source = join(dir, 'source'), target = join(dir, 'converted.m4a')
  try {
    await writeFile(source, media.buffer)
    try {
      await run('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', '-protocol_whitelist', 'file,pipe', '-i', source,
        '-vn', '-map', '0:a:0', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', '-fs', '10485760', target],
      { timeout: 30_000, maxBuffer: 64 * 1024 })
    } catch { throw new Error('No se pudo convertir el audio original al formato de Instagram.') }
    const buffer = await readFile(target)
    if (!buffer.length || buffer.length >= 10 * 1024 * 1024) throw new Error('Audio demasiado grande para Instagram.')
    const hash = createHash('sha256').update(buffer).digest('hex')
    const path = `${accountId}/instagram/audio/${hash}.m4a`
    const storage = supabaseAdmin().storage.from(SOCIAL_MEDIA_BUCKET)
    const uploaded = await storage.upload(path, buffer, { contentType: 'audio/mp4', upsert: true })
    if (uploaded.error) throw new Error('No se pudo preparar el audio de Instagram.')
    const signed = await storage.createSignedUrl(path, 3600)
    if (signed.error || !signed.data?.signedUrl) throw new Error('No se pudo crear el enlace temporal del audio.')
    return signed.data.signedUrl
  } finally {
    await Promise.allSettled([unlink(source), unlink(target)])
    await rmdir(dir).catch(() => {})
  }
}
